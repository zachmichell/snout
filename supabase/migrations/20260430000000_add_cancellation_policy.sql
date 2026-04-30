-- Migration: add_cancellation_policy
--
-- Each business has its own cancellation rules. We store two windows on the
-- organization: a general one for reservations (daycare, boarding, etc.) and
-- a grooming-specific one (typically longer, because groomer slots are harder
-- to refill on short notice).
--
-- Both are integer hours. A cancellation initiated within (start_at - window)
-- is "late" and the iOS app surfaces a warning to the parent about potential
-- fees per the facility's policy. Outside the window, cancellations proceed
-- without warning.
--
-- Defaults: 24 hours for general, 48 hours for grooming. Staff can adjust
-- per-org via the web Settings panel.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS cancellation_policy_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS grooming_cancellation_policy_hours integer NOT NULL DEFAULT 48;

COMMENT ON COLUMN public.organizations.cancellation_policy_hours IS
  'Hours before start_at within which a cancellation may incur a fee per facility policy. Default 24.';
COMMENT ON COLUMN public.organizations.grooming_cancellation_policy_hours IS
  'Same as cancellation_policy_hours but for grooming appointments. Default 48, typically longer because groomer slots are harder to refill.';
