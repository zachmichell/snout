-- Close the narrow race window in the cross-table pet-assignment triggers
-- added by 20260424130500_cross_table_pet_assignment_exclusion.sql.
--
-- Without the lock, two concurrent inserts from different sessions (one to
-- playgroup_assignments, one to kennel_run_assignments) could each pass
-- their trigger check before either committed, letting a pet end up in
-- both a playgroup and a kennel at the same time.
--
-- Fix: acquire a per-pet transaction-scoped advisory lock at the top of
-- each trigger. Two transactions touching assignments for the same pet
-- serialize on that lock; the second sees the first's committed row and
-- raises exclusion_violation correctly.
--
-- The lock uses the two-arg (int4, int4) form of pg_advisory_xact_lock so
-- we can use hashtext directly. First arg is a namespace constant to
-- avoid collisions with other advisory-lock users in the DB; second arg
-- is a per-pet key.

CREATE OR REPLACE FUNCTION public.prevent_kennel_overlap_with_playgroup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('pet-assignment'),
    hashtext(NEW.pet_id::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.playgroup_assignments pa
    WHERE pa.pet_id = NEW.pet_id
      AND tstzrange(pa.assigned_at, coalesce(pa.removed_at, 'infinity'::timestamptz), '[)')
       && tstzrange(NEW.assigned_at, coalesce(NEW.removed_at, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Pet % already has an overlapping playgroup assignment', NEW.pet_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_playgroup_overlap_with_kennel()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('pet-assignment'),
    hashtext(NEW.pet_id::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.kennel_run_assignments ka
    WHERE ka.pet_id = NEW.pet_id
      AND tstzrange(ka.assigned_at, coalesce(ka.removed_at, 'infinity'::timestamptz), '[)')
       && tstzrange(NEW.assigned_at, coalesce(NEW.removed_at, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Pet % already has an overlapping kennel run assignment', NEW.pet_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;
