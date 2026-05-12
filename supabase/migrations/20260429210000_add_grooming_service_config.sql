-- Migration: add_grooming_service_config
--
-- Two related changes that prepare the `services` table for the grooming
-- booking flow:
--
-- 1. Add a `default_duration_minutes` column. The slot picker needs to know
--    how much of the groomer's day to carve out for each booking, and the
--    `services` table didn't have that. Nullable for non-bookable services
--    or for services that don't need a duration. v2 will let per-groomer
--    `groomer_time_matrix` rows override this default per (size, level).
--
-- 2. Force `max_pets_per_booking = 1` on grooming services and seed sensible
--    default durations. Per the booking design, grooming is one pet per
--    appointment — multi-pet households book each pet separately so the
--    groomer's slot is correctly sized.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer;

UPDATE public.services
SET
  max_pets_per_booking = 1,
  default_duration_minutes = CASE
    WHEN name ILIKE '%nail trim%'    THEN 30
    WHEN name ILIKE '%bath%brush%'   THEN 60
    WHEN name ILIKE '%full groom%'   THEN 90
    WHEN name ILIKE '%tidy%'         THEN 45
    ELSE 60
  END,
  updated_at = NOW()
WHERE module = 'grooming'
  AND deleted_at IS NULL;
