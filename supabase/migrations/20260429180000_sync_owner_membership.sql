-- Migration: sync_owner_membership
--
-- Purpose: Ensure every owner with a profile_id has a corresponding
-- `memberships` row with role='customer' in the same organization. Without
-- this, RLS policies that gate org-scoped tables (locations, webcams,
-- services, etc.) on `is_org_member()` return empty for pet parents — making
-- their facility's reference data invisible to them.
--
-- The owners table already has an "Owner self-read" policy keyed on
-- `profile_id = auth.uid()`, so a pet parent can read their own owner row at
-- sign-in. But other tables only have tenant-isolation policies. The
-- consistent fix is to make sure pet parents are real org members in the
-- memberships table; iOS spec assumes that's the case ("Pet parents have
-- role = 'customer' in a single org").
--
-- Two parts:
--   1) Backfill memberships for existing owners that don't have one.
--   2) Trigger: keep memberships in sync going forward whenever an owner is
--      created or has profile_id / organization_id / deleted_at modified.
--
-- Both parts are idempotent.

-- ----------------------------------------------------------------------------
-- 1. Backfill missing memberships
-- ----------------------------------------------------------------------------
INSERT INTO public.memberships (profile_id, organization_id, role, active)
SELECT DISTINCT o.profile_id, o.organization_id, 'customer'::membership_role, true
FROM public.owners o
WHERE o.profile_id IS NOT NULL
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.profile_id = o.profile_id
      AND m.organization_id = o.organization_id
  )
ON CONFLICT (profile_id, organization_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Trigger function
-- ----------------------------------------------------------------------------
-- Whenever an owner is created or has its profile_id / organization_id /
-- deleted_at touched, make sure the matching membership exists. We never
-- downgrade or override an existing membership's role (a customer who's been
-- promoted to staff shouldn't get demoted by an owner-row update); we only
-- re-activate a previously-deactivated row.
CREATE OR REPLACE FUNCTION public.sync_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    INSERT INTO public.memberships (profile_id, organization_id, role, active)
    VALUES (NEW.profile_id, NEW.organization_id, 'customer', true)
    ON CONFLICT (profile_id, organization_id) DO UPDATE
      SET active = true
      WHERE memberships.active = false;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Trigger on owners
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_owner_membership ON public.owners;
CREATE TRIGGER trg_sync_owner_membership
AFTER INSERT OR UPDATE OF profile_id, organization_id, deleted_at
ON public.owners
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_membership();
