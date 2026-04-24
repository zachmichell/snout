-- Harden create_membership: onboarding branch must refuse to attach to
-- an organization that already has active members.
--
-- Without this, a freshly-signed-up user (zero active memberships) could
-- call create_membership(<any existing org id>, ...) and become owner of
-- an org they don't belong to. Legitimate onboarding in Onboarding.tsx
-- always passes a just-created org id (empty at call time), so the new
-- check is transparent to that flow.
--
-- Role is already hardcoded to 'owner' in this branch (from migration
-- 20260419195147); the _role parameter is preserved for the admin branch.

CREATE OR REPLACE FUNCTION public.create_membership(_org_id uuid, _role membership_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _active_count int;
  _any_existing int;
  _is_admin boolean;
  _new_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*) INTO _active_count
  FROM public.memberships
  WHERE profile_id = _caller AND active = true;

  IF _active_count = 0 THEN
    SELECT count(*) INTO _any_existing
    FROM public.memberships
    WHERE profile_id = _caller AND organization_id = _org_id;

    IF _any_existing > 0 THEN
      RAISE EXCEPTION 'Membership already exists for this organization';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.memberships
      WHERE organization_id = _org_id AND active = true
    ) THEN
      RAISE EXCEPTION 'Organization already has members; ask an admin to add you';
    END IF;

    INSERT INTO public.memberships (profile_id, organization_id, role, active)
    VALUES (_caller, _org_id, 'owner'::membership_role, true)
    RETURNING id INTO _new_id;

    RETURN _new_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE profile_id = _caller
      AND organization_id = _org_id
      AND active = true
      AND role IN ('owner', 'admin')
  ) INTO _is_admin;

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'Insufficient permissions to create membership';
  END IF;

  INSERT INTO public.memberships (profile_id, organization_id, role, active)
  VALUES (_caller, _org_id, _role, true)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$function$;
