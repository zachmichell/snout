-- Auto-create a pending deposit when a reservation is booked (Milestone A, 3b).
--
-- Mirrors computeDepositCents() (apps/web/src/lib/deposits.ts) in SQL so a
-- deposit is created on EVERY booking path — staff web, owner self-serve, iOS
-- — from one place, instead of wiring the logic into each creation site. The
-- created deposit is 'pending'; staff collect it via "Charge card"
-- (collect-deposit) or "Mark paid", or the owner pays it.
--
-- Dark-ships: only fires when the org's deposit_settings.enabled is true
-- (default false), so it's inert until an operator turns deposits on.
--
-- Amount = per-service override (service_deposit_overrides, if enabled) else
-- the org default (deposit_settings); fixed = that cents value, percentage =
-- basis-points applied to services.base_price_cents. (Percentage is computed
-- off the service base price, before add-ons — a reasonable deposit basis at
-- booking time, when the full invoice total doesn't exist yet.)
--
-- Scope guards (v1): only future, non-recurring, pre-arrival bookings
-- (status requested/confirmed) with a primary owner. Historical/imported and
-- recurring-series bookings are intentionally skipped to avoid surprising
-- bulk-deposit creation; recurring-series deposits are a later refinement.
--
-- SECURITY DEFINER + a catch-all EXCEPTION so a deposit-creation hiccup can
-- never roll back the reservation insert.

create or replace function public.create_reservation_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _enabled boolean;
  _set_type text;
  _set_fixed integer;
  _set_bp integer;
  _ov_type text;
  _ov_fixed integer;
  _ov_bp integer;
  _has_override boolean := false;
  _base_cents integer := 0;
  _amount_type text;
  _fixed_cents integer;
  _pct_bp integer;
  _amount integer := 0;
begin
  -- Eligibility gates.
  if NEW.primary_owner_id is null then return NEW; end if;
  if NEW.status not in ('requested', 'confirmed') then return NEW; end if;
  if NEW.start_at is null or NEW.start_at < now() then return NEW; end if;
  -- Skip recurring-series occurrences (avoid a deposit per occurrence). Gate
  -- on the structural FK (recurring_group_id) as well as the boolean flag, so
  -- a caller that forgets to set is_recurring can't accidentally generate a
  -- deposit for every occurrence.
  if coalesce(NEW.is_recurring, false) or NEW.recurring_group_id is not null then return NEW; end if;

  -- Org must have deposits enabled.
  select enabled, amount_type, default_amount_cents, default_percentage_bp
    into _enabled, _set_type, _set_fixed, _set_bp
  from public.deposit_settings
  where organization_id = NEW.organization_id;
  if not found or not coalesce(_enabled, false) then return NEW; end if;

  -- Idempotency: never create a second deposit for the same reservation.
  if exists (select 1 from public.deposits where reservation_id = NEW.id) then
    return NEW;
  end if;

  -- Service base price (for percentage deposits).
  if NEW.service_id is not null then
    select coalesce(base_price_cents, 0) into _base_cents
    from public.services where id = NEW.service_id;
    _base_cents := coalesce(_base_cents, 0);
  end if;

  -- Per-service override wins over the org default.
  if NEW.service_id is not null then
    select amount_type, amount_cents, percentage_bp
      into _ov_type, _ov_fixed, _ov_bp
    from public.service_deposit_overrides
    where service_id = NEW.service_id and enabled = true
    limit 1;
    if found then _has_override := true; end if;
  end if;

  if _has_override then
    _amount_type := _ov_type;
    _fixed_cents := _ov_fixed;
    _pct_bp := _ov_bp;
  else
    _amount_type := _set_type;
    _fixed_cents := _set_fixed;
    _pct_bp := _set_bp;
  end if;

  if _amount_type = 'fixed' then
    _amount := greatest(0, coalesce(_fixed_cents, 0));
  else
    _amount := greatest(0, round(_base_cents * coalesce(_pct_bp, 0) / 10000.0)::integer);
  end if;

  if _amount <= 0 then return NEW; end if;

  insert into public.deposits (
    organization_id, reservation_id, owner_id, service_id,
    amount_cents, status, currency
  ) values (
    NEW.organization_id, NEW.id, NEW.primary_owner_id, NEW.service_id,
    _amount, 'pending', 'cad'
  );

  return NEW;
exception when others then
  raise notice 'create_reservation_deposit failed for reservation %: %', NEW.id, sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists reservations_create_deposit on public.reservations;
create trigger reservations_create_deposit
  after insert on public.reservations
  for each row execute function public.create_reservation_deposit();

-- Hard DB backstop for at-most-one deposit per reservation. The trigger
-- already guards with an EXISTS check, but a partial unique index makes a
-- duplicate structurally impossible (a future re-import / manual backfill /
-- restored app insert can't create a second collectible deposit). Mirrors
-- uniq_invoices_reservation_live. The WHERE clause is required: reservation_id
-- is nullable and the FK is ON DELETE SET NULL, so multiple deposits may
-- legitimately carry NULL reservation_id. A violation is swallowed by the
-- trigger's catch-all EXCEPTION rather than blocking the booking.
create unique index if not exists deposits_one_per_reservation
  on public.deposits (reservation_id)
  where reservation_id is not null;
