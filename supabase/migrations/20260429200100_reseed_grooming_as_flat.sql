-- Migration: reseed_grooming_as_flat
--
-- Convert existing grooming-module services from `hourly` to the new `flat`
-- duration type. Grooming is priced per service-level, not per hour.
--
-- Idempotent: only updates rows that are still on `hourly`. Re-running this
-- migration on a system where grooming services have been further customized
-- (e.g. someone deliberately switched a service back to hourly) is a no-op
-- for that row.
--
-- Scoped to `module = 'grooming'` so we don't accidentally flatten other
-- hourly services (training, walking, etc.) that legitimately are per-hour.

UPDATE public.services
SET duration_type = 'flat'::duration_type_enum,
    updated_at = NOW()
WHERE module = 'grooming'
  AND duration_type = 'hourly'
  AND deleted_at IS NULL;
