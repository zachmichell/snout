-- Reliability Batch D: atomic owner-to-owner credit transfer.
--
-- Use case: a customer's pet moves to a new household ("our friend is
-- adopting Sparky and we want to give them our remaining 12 daycare
-- credits") or a household splits and credits need to follow the pet.
-- Today the operator has to do two manual_adjustment rows and hope no
-- one decrements between them. This RPC does both legs in one txn.
--
-- Both legs land as `manual_adjustment` ledger rows, with a
-- `note` that includes the matching transfer id so the audit log shows
-- the pair belongs together. The trigger that maintains the
-- per-owner cache fires on each insert, so both owners' caches end
-- up consistent without us doing it manually.

create or replace function public.transfer_credits(
  p_from_owner_id uuid,
  p_to_owner_id uuid,
  p_full integer default 0,
  p_half integer default 0,
  p_nights integer default 0,
  p_note text default null,
  p_actor_kind text default 'staff',
  p_actor_label text default 'Staff',
  p_staff_code_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _org uuid;
  _to_org uuid;
  _from_full int;
  _from_half int;
  _from_nights int;
  _transfer_id uuid := gen_random_uuid();
  _from_note text;
  _to_note text;
begin
  if p_full < 0 or p_half < 0 or p_nights < 0 then
    raise exception 'transfer_credits: counts must be non-negative' using errcode = '22023';
  end if;
  if p_full = 0 and p_half = 0 and p_nights = 0 then
    raise exception 'transfer_credits: must transfer at least one credit' using errcode = '22023';
  end if;
  if p_from_owner_id = p_to_owner_id then
    raise exception 'transfer_credits: source and destination owners must differ' using errcode = '22023';
  end if;

  -- Both owners must live in the same org. We pin to the source org
  -- so credits can't accidentally move across multi-tenant boundaries
  -- if a UI bug ever passes mismatched ids.
  select organization_id, daycare_full_day_credits, daycare_half_day_credits, boarding_night_credits
    into _org, _from_full, _from_half, _from_nights
    from public.owners
   where id = p_from_owner_id
   for update;
  if _org is null then
    raise exception 'transfer_credits: source owner not found' using errcode = 'P0002';
  end if;

  select organization_id into _to_org
    from public.owners
   where id = p_to_owner_id
   for update;
  if _to_org is null then
    raise exception 'transfer_credits: destination owner not found' using errcode = 'P0002';
  end if;
  if _to_org <> _org then
    raise exception 'transfer_credits: owners must be in the same organization'
      using errcode = '42501';
  end if;

  -- Source must have enough of each requested type.
  if coalesce(_from_full,0) < p_full
     or coalesce(_from_half,0) < p_half
     or coalesce(_from_nights,0) < p_nights then
    raise exception 'transfer_credits: insufficient credits on source owner'
      using errcode = '22023';
  end if;

  _from_note := format(
    'Transfer %s -> %s%s',
    p_from_owner_id, p_to_owner_id,
    case when p_note is null or p_note = '' then '' else ' (' || p_note || ')' end
  );
  _to_note := format(
    'Transfer %s <- %s%s',
    p_to_owner_id, p_from_owner_id,
    case when p_note is null or p_note = '' then '' else ' (' || p_note || ')' end
  );

  -- Negative leg on source.
  insert into public.credit_ledger (
    organization_id, owner_id, kind,
    delta_full, delta_half, delta_nights,
    note, actor_kind, actor_label, staff_code_id,
    reference_id, reference_type
  ) values (
    _org, p_from_owner_id, 'manual_adjustment',
    -p_full, -p_half, -p_nights,
    _from_note, p_actor_kind, p_actor_label, p_staff_code_id,
    _transfer_id, 'credit_transfer'
  );

  -- Positive leg on destination.
  insert into public.credit_ledger (
    organization_id, owner_id, kind,
    delta_full, delta_half, delta_nights,
    note, actor_kind, actor_label, staff_code_id,
    reference_id, reference_type
  ) values (
    _org, p_to_owner_id, 'manual_adjustment',
    p_full, p_half, p_nights,
    _to_note, p_actor_kind, p_actor_label, p_staff_code_id,
    _transfer_id, 'credit_transfer'
  );

  return jsonb_build_object(
    'ok', true,
    'transfer_id', _transfer_id,
    'from_owner_id', p_from_owner_id,
    'to_owner_id', p_to_owner_id,
    'full', p_full,
    'half', p_half,
    'nights', p_nights
  );
end;
$fn$;

revoke all on function public.transfer_credits(uuid, uuid, integer, integer, integer, text, text, text, uuid) from public;
grant execute on function public.transfer_credits(uuid, uuid, integer, integer, integer, text, text, text, uuid) to authenticated;
