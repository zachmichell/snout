-- Migration: add_flat_duration_type
--
-- Add a `flat` value to `duration_type_enum` for services priced per
-- appointment rather than per hour / per day / per night. Grooming is the
-- canonical example: "Bath & Brush" is a flat $55 regardless of how long the
-- groomer takes; the parent doesn't pay by the hour. Same applies to nail
-- trims, training sessions, walking add-ons priced per outing, etc.
--
-- Booking-wizard semantics for `flat`:
--   • UI shows date + start time only (no end time, no duration count).
--   • Reservation `end_at` defaults to `start_at + 60 minutes` (a follow-up
--     migration could add `services.default_duration_minutes` if facilities
--     want per-service control).
--   • Price = base_price_cents × pet_count. No nights/hours multiplier.
--
-- A separate migration immediately after this one re-seeds the existing
-- grooming services from `hourly` to `flat`.

ALTER TYPE public.duration_type_enum ADD VALUE IF NOT EXISTS 'flat';
