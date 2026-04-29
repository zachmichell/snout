-- Fix: organizations.country is country_enum and organizations.currency is
-- currency_enum; create_organization_with_owner took the params as text and
-- the INSERT failed on implicit cast (SQLSTATE 42804). Add explicit casts
-- inside the function so callers can keep passing plain strings.
--
-- Parameter signature is unchanged (text) so the function overload the
-- client calls stays the same.

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

  SELECT count(*) INTO _active_count
  FROM public.memberships
  WHERE profile_id = _caller AND active = true;

  IF _active_count > 0 THEN
    RAISE EXCEPTION 'Caller already has an active membership; additional orgs require an invite';
  END IF;

  INSERT INTO public.organizations (name, slug, country, currency, timezone)
  VALUES (
    _name,
    _slug,
    _country::country_enum,
    _currency::currency_enum,
    _timezone
  )
  RETURNING id INTO _new_org_id;

  INSERT INTO public.memberships (profile_id, organization_id, role, active)
  VALUES (_caller, _new_org_id, 'owner'::membership_role, true);

  RETURN _new_org_id;
END;
$$;
