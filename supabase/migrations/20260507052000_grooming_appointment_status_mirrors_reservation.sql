-- 7.x: Keep grooming_appointments.status in sync with the parent
-- reservation. Without this, cancelling a reservation from the owner
-- portal (or anywhere else) leaves the linked grooming_appointment
-- on its previous status. The staff Grooming page reads from
-- grooming_appointments and would still show the cancelled request
-- in its Pending Requests panel.
--
-- Mirror policy:
--   reservations.status = 'cancelled'  -> grooming_appointments.status = 'cancelled'
--   reservations.status = 'no_show'    -> grooming_appointments.status = 'no_show'
-- We intentionally do NOT auto-flip 'requested' -> 'scheduled' on
-- staff confirmation; that needs the staff to also pick a groomer
-- (when the customer left it as "Any available") and the existing
-- staff confirmation UI handles that explicitly.
--
-- Only updates rows whose status is "still actionable" (requested,
-- scheduled, pending, in_progress) so a manually-completed appointment
-- that happens to share a reservation can't be retroactively flipped.

create or replace function public.tg_reservations_mirror_to_grooming_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if (TG_OP = 'UPDATE')
     and new.status is distinct from old.status
     and new.status in ('cancelled', 'no_show') then
    update public.grooming_appointments
       set status = new.status
     where reservation_id = new.id
       and status in ('requested', 'pending', 'scheduled', 'in_progress');
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_reservations_mirror_to_grooming_appointment on public.reservations;
create trigger trg_reservations_mirror_to_grooming_appointment
  after update of status on public.reservations
  for each row
  execute function public.tg_reservations_mirror_to_grooming_appointment();

comment on function public.tg_reservations_mirror_to_grooming_appointment() is
  '7.x: Keeps grooming_appointments.status in sync with reservations.status for cancelled / no_show transitions, so the staff Grooming page reflects owner-side cancellations immediately.';
