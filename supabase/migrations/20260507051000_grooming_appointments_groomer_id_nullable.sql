-- 7.1 follow-up: relax grooming_appointments.groomer_id to allow NULL.
--
-- The owner-facing booking wizard needs to support "Any available
-- groomer" — staff assign the actual groomer on confirmation. The
-- prior NOT NULL constraint required the customer to know who's
-- working, which they generally don't.
--
-- Existing rows are unaffected (all currently have a groomer_id).
-- Future workflows that move an appointment back to "any" can simply
-- set the column to NULL.

alter table public.grooming_appointments
  alter column groomer_id drop not null;

comment on column public.grooming_appointments.groomer_id is
  '7.1: NULL means the appointment is requested without a specific groomer; staff assign on confirmation. NOT NULL while scheduled / in_progress / completed in practice (enforced by application, not DB constraint).';
