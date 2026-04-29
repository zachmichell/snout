-- Atomic organization + owner-membership creation.
--
-- Replaces the two-step onboarding flow (insert organizations, then call
-- create_membership) which had two problems:
--   1. INSERT ... RETURNING on organizations tripped the SELECT policy
--      (is_org_member(id)) for the caller who wasn't a member yet.
--   2. Between the two client calls, an attacker who guessed the new org's
--      UUID could insert themselves as a member before the legitimate
--      owner membership landed.
--
-- This RPC does both inserts in one transaction under SECURITY DEFINER,
-- so neither problem applies. It's the only sanctioned path for a user
-- to bootstrap themselves into a new org.

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  _name text,
  _slug text,
  _country text,
  _currency text,
  _timezone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _active_count int;
  _new_org_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Onboarding-only: caller must have no existing active memberships.
  -- Extra orgs for an existing user must go through an invite flow.
  SELECT count(*) INTO _active_count
  FROM public.memberships
  WHERE profile_id = _caller AND active = true;

  IF _active_count > 0 THEN
    RAISE EXCEPTION 'Caller already has an active membership; additional orgs require an invite';
  END IF;

  INSERT INTO public.organizations (name, slug, country, currency, timezone)
  VALUES (_name, _slug, _country, _currency, _timezone)
  RETURNING id INTO _new_org_id;

  INSERT INTO public.memberships (profile_id, organization_id, role, active)
  VALUES (_caller, _new_org_id, 'owner'::membership_role, true);

  RETURN _new_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.create_organization_with_owner(text, text, text, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Now the onboarding branch in create_membership is dead code. Remove it so
-- there is exactly one sanctioned path for self-membership (the new RPC
-- above). The admin-adds-member branch stays — that's still the right shape
-- for future invite / add-staff flows.

CREATE OR REPLACE FUNCTION public.create_membership(_org_id uuid, _role membership_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_admin boolean;
  _new_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Self-onboarding is no longer allowed through this function; use
  -- create_organization_with_owner() for the first-org bootstrap.
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
