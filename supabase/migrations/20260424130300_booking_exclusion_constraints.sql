-- Database-enforced non-overlap on bookable resources.
--
-- Without these, availability is checked client-side only. Two concurrent
-- users can both "see" a slot as free, both INSERT, and end up with the
-- same physical resource double-booked at the same time. An exclusion
-- constraint serializes the check in the database — one insert succeeds,
-- the other fails with SQLSTATE 23P01 (exclusion_violation).
--
-- Cross-table rules (pet cannot be in playgroup AND kennel at the same
-- time) are NOT enforced here; exclusion constraints are per-table. See
-- the P0 #4 follow-up note in the assessment — options are a unified
-- assignments table or a trigger.
--
-- Pre-checks — if any of these return rows, existing data already has
-- overlaps and the ALTER TABLE will fail. Resolve (cancel or soft-delete
-- the loser) before running this migration:
--
--   -- 1. Reservations overlapping on the same suite
--   SELECT a.id AS a_id, b.id AS b_id, a.suite_id,
--          a.start_at, a.end_at, b.start_at, b.end_at
--   FROM public.reservations a
--   JOIN public.reservations b
--     ON a.suite_id = b.suite_id
--    AND a.id < b.id
--    AND tstzrange(a.start_at, a.end_at, '[)')
--     && tstzrange(b.start_at, b.end_at, '[)')
--   WHERE a.suite_id IS NOT NULL
--     AND a.deleted_at IS NULL AND b.deleted_at IS NULL
--     AND a.status NOT IN ('cancelled','no_show')
--     AND b.status NOT IN ('cancelled','no_show');
--
--   -- 2. Grooming appointments overlapping on the same groomer
--   SELECT a.id, b.id, a.groomer_id
--   FROM public.grooming_appointments a
--   JOIN public.grooming_appointments b
--     ON a.groomer_id = b.groomer_id
--    AND a.id < b.id
--    AND tsrange(
--          (a.appointment_date + a.start_time)::timestamp,
--          (a.appointment_date + a.start_time + (a.estimated_duration_minutes * interval '1 minute'))::timestamp,
--          '[)') &&
--        tsrange(
--          (b.appointment_date + b.start_time)::timestamp,
--          (b.appointment_date + b.start_time + (b.estimated_duration_minutes * interval '1 minute'))::timestamp,
--          '[)')
--   WHERE a.status NOT IN ('cancelled','no_show')
--     AND b.status NOT IN ('cancelled','no_show');
--
--   -- 3. Playgroup assignments: pet in two playgroups with overlapping windows
--   SELECT a.id, b.id, a.pet_id
--   FROM public.playgroup_assignments a
--   JOIN public.playgroup_assignments b
--     ON a.pet_id = b.pet_id
--    AND a.id < b.id
--    AND tstzrange(a.assigned_at, coalesce(a.removed_at, 'infinity'::timestamptz), '[)')
--     && tstzrange(b.assigned_at, coalesce(b.removed_at, 'infinity'::timestamptz), '[)');
--
--   -- 4. Kennel run assignments (same shape as #3 but kennel_run_assignments)
--   SELECT a.id, b.id, a.pet_id
--   FROM public.kennel_run_assignments a
--   JOIN public.kennel_run_assignments b
--     ON a.pet_id = b.pet_id
--    AND a.id < b.id
--    AND tstzrange(a.assigned_at, coalesce(a.removed_at, 'infinity'::timestamptz), '[)')
--     && tstzrange(b.assigned_at, coalesce(b.removed_at, 'infinity'::timestamptz), '[)');

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Reservations: no two active reservations overlap on the same suite.
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_no_suite_overlap
  EXCLUDE USING gist (
    suite_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (
    suite_id IS NOT NULL
    AND deleted_at IS NULL
    AND status NOT IN ('cancelled', 'no_show')
  );

-- 2. Grooming appointments: no two active appointments overlap for the same
-- groomer. Range is computed from date + time + duration (wall-clock / local
-- time at the salon — tsrange not tstzrange, matching the column types).
ALTER TABLE public.grooming_appointments
  ADD CONSTRAINT grooming_no_groomer_overlap
  EXCLUDE USING gist (
    groomer_id WITH =,
    tsrange(
      (appointment_date + start_time)::timestamp,
      (appointment_date + start_time + (estimated_duration_minutes * interval '1 minute'))::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));

-- 3. Playgroup assignments: a pet can only be in one playgroup at a time.
-- NULL removed_at means "still active" — modelled as +infinity upper bound.
ALTER TABLE public.playgroup_assignments
  ADD CONSTRAINT playgroup_no_pet_double_assign
  EXCLUDE USING gist (
    pet_id WITH =,
    tstzrange(assigned_at, coalesce(removed_at, 'infinity'::timestamptz), '[)') WITH &&
  );

-- 4. Kennel run assignments: same rule for kennels.
ALTER TABLE public.kennel_run_assignments
  ADD CONSTRAINT kennel_no_pet_double_assign
  EXCLUDE USING gist (
    pet_id WITH =,
    tstzrange(assigned_at, coalesce(removed_at, 'infinity'::timestamptz), '[)') WITH &&
  );
