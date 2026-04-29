-- Step 1 of the staff PIN hardening: store PINs as bcrypt hashes alongside
-- the existing plaintext column, and expose a verify_staff_pin RPC so
-- clients never have to fetch PIN values to check them.
--
-- This migration is ADDITIVE — the pin_code column stays intact so any
-- still-running client keeps working. Step 2 (client switches to the RPC)
-- ships next. Step 3 (REVOKE SELECT on pin_code and/or DROP COLUMN) is a
-- separate migration that can run once the client deploy is verified.

-- pgcrypto already installed in extensions schema; referencing fully qualified.

ALTER TABLE public.staff_codes
  ADD COLUMN IF NOT EXISTS pin_hash text;

-- Backfill hashes for any rows with an existing plaintext pin.
UPDATE public.staff_codes
SET pin_hash = extensions.crypt(pin_code, extensions.gen_salt('bf'))
WHERE pin_hash IS NULL AND pin_code IS NOT NULL;

-- Server-side PIN verification. Returns the staff_code id on match,
-- NULL otherwise. Uses crypt() for constant-time comparison (pgcrypto).
-- SECURITY DEFINER lets unauthenticated callers run it if ever needed,
-- but we still gate on is_org_member to require a valid org session.
CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  _org_id uuid,
  _pin text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _match uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  IF _pin IS NULL OR char_length(_pin) < 4 OR char_length(_pin) > 12 THEN
    RETURN NULL;
  END IF;

  -- crypt() with the stored hash as salt returns the hash on match.
  SELECT sc.id
    INTO _match
    FROM public.staff_codes sc
   WHERE sc.organization_id = _org_id
     AND sc.is_active = true
     AND sc.pin_hash IS NOT NULL
     AND extensions.crypt(_pin, sc.pin_hash) = sc.pin_hash
   LIMIT 1;

  IF _match IS NOT NULL THEN
    UPDATE public.staff_codes SET last_used_at = now() WHERE id = _match;
  END IF;

  RETURN _match;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text) TO authenticated;

-- Create: admins add a new staff code with PIN hashed server-side.
-- Returns the new row id.
CREATE OR REPLACE FUNCTION public.create_staff_code(
  _display_name text,
  _pin text,
  _role text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _org uuid;
  _new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT organization_id INTO _org
    FROM public.memberships
   WHERE profile_id = auth.uid() AND active = true
   LIMIT 1;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'No active organization';
  END IF;
  IF NOT public.is_org_admin(_org) THEN
    RAISE EXCEPTION 'Only org admins can create staff codes';
  END IF;
  IF _pin IS NULL OR char_length(_pin) < 4 OR char_length(_pin) > 12 THEN
    RAISE EXCEPTION 'PIN must be 4-12 characters';
  END IF;

  INSERT INTO public.staff_codes (
    organization_id, display_name, role, pin_hash, is_active
  ) VALUES (
    _org, _display_name, _role::membership_role,
    extensions.crypt(_pin, extensions.gen_salt('bf')),
    true
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.create_staff_code(text, text, text)
  TO authenticated;

-- Update PIN only (admins). display_name/role/is_active still go through
-- the table UPDATE with existing RLS (admin-only). Separating PIN here
-- keeps the hashing concern server-side.
CREATE OR REPLACE FUNCTION public.update_staff_code_pin(
  _id uuid,
  _new_pin text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _new_pin IS NULL OR char_length(_new_pin) < 4 OR char_length(_new_pin) > 12 THEN
    RAISE EXCEPTION 'PIN must be 4-12 characters';
  END IF;

  SELECT organization_id INTO _org
    FROM public.staff_codes
   WHERE id = _id;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Staff code not found';
  END IF;
  IF NOT public.is_org_admin(_org) THEN
    RAISE EXCEPTION 'Only org admins can change staff PINs';
  END IF;

  UPDATE public.staff_codes
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf'))
  WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.update_staff_code_pin(uuid, text)
  TO authenticated;
