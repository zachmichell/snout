-- Add a 'trainer' staff tier to membership_role, for the staff iOS app's
-- training lane (class rosters / attendance). Permissions are defined
-- client-side (apps/web/src/lib/permissions.ts + the Swift mirror in the
-- staff app); this migration only makes the enum value assignable.
--
-- Trainer/groomer → user links already exist and need no schema change:
--   class_instances.instructor_user_id  (the trainer's user)
--   groomers.staff_member_id -> profiles.id  (the groomer's user)

ALTER TYPE public.membership_role ADD VALUE IF NOT EXISTS 'trainer';
