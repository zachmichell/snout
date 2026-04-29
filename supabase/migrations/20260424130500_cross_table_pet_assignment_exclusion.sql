-- Cross-table exclusion: a pet can be in at most one physical zone
-- (playgroup OR kennel run) at a time.
--
-- Per-table exclusion constraints were added in
-- 20260424130300_booking_exclusion_constraints.sql. They prevent the same
-- pet appearing twice in playgroup_assignments, and twice in
-- kennel_run_assignments. What remains is the cross-table case: the same
-- pet can't be in both a playgroup AND a kennel at the same time.
--
-- Exclusion constraints are per-table; the cross-table equivalent is a
-- BEFORE INSERT OR UPDATE trigger that consults the sibling table and
-- raises exclusion_violation on overlap.
--
-- Known limitation — there's a tiny race window under concurrent inserts
-- from different sessions (one to each table). Both triggers read the
-- OTHER table before either commits, both see no conflict, both insert.
-- Closing this fully would need SERIALIZABLE isolation or an advisory
-- lock per pet_id; the probability of the race in real operations (two
-- different staff tablets double-assigning the same pet within
-- milliseconds) is low enough that we're accepting the window for now.
-- Flag for a follow-up if it's observed in practice.
--
-- Pre-check — existing cross-assignments that would start failing on
-- UPDATE. Rows that already exist and overlap aren't rejected by trigger
-- creation (triggers don't retroactively validate). Resolve these now
-- to avoid surprise failures later:
--
--   SELECT pa.id AS playgroup_assign, ka.id AS kennel_assign, pa.pet_id
--   FROM public.playgroup_assignments pa
--   JOIN public.kennel_run_assignments ka
--     ON pa.pet_id = ka.pet_id
--    AND tstzrange(pa.assigned_at, coalesce(pa.removed_at, 'infinity'::timestamptz), '[)')
--     && tstzrange(ka.assigned_at, coalesce(ka.removed_at, 'infinity'::timestamptz), '[)');

-- Raised when inserting into kennel_run_assignments while the same pet
-- has an overlapping playgroup assignment.
CREATE OR REPLACE FUNCTION public.prevent_kennel_overlap_with_playgroup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
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

-- Mirror: inserting into playgroup_assignments while a kennel run
-- assignment overlaps for the same pet.
CREATE OR REPLACE FUNCTION public.prevent_playgroup_overlap_with_kennel()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_kennel_no_playgroup_overlap ON public.kennel_run_assignments;
CREATE TRIGGER trg_kennel_no_playgroup_overlap
  BEFORE INSERT OR UPDATE ON public.kennel_run_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_kennel_overlap_with_playgroup();

DROP TRIGGER IF EXISTS trg_playgroup_no_kennel_overlap ON public.playgroup_assignments;
CREATE TRIGGER trg_playgroup_no_kennel_overlap
  BEFORE INSERT OR UPDATE ON public.playgroup_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_playgroup_overlap_with_kennel();
