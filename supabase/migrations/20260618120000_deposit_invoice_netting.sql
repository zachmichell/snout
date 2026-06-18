-- Deposit → invoice netting: DB primitives (Milestone A, Track 3c).
--
-- A paid deposit is credited against its reservation's invoice so the customer
-- pays (total − deposit) at checkout. This migration ships the SCHEMA + the two
-- RPCs only. The auto-firing triggers are intentionally NOT created here — they
-- return in the QBO-prepayment series (PR-5) once deposit credits are excluded
-- from QuickBooks sync, because the internal credit payment row would otherwise
-- be mis-synced to QBO (double-count). Until then the RPCs are callable but
-- nothing fires them automatically.
--
-- Accounting note: the credit is recorded as a real payments row so checkout
-- (which charges total_cents − amount_paid_cents) nets automatically and Snout's
-- invoice balance stays correct. The row deliberately carries NO
-- stripe_payment_intent_id and is attributed via source_deposit_id; the QBO
-- layer (later PRs) excludes these rows and posts the deposit's accounting via a
-- dedicated customer-deposit-liability JournalEntry path instead.

-- ── Schema (additive) ──────────────────────────────────────────────────────
alter table public.deposits
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
create index if not exists deposits_invoice_id_idx
  on public.deposits(invoice_id) where invoice_id is not null;

alter table public.payments
  add column if not exists source_deposit_id uuid references public.deposits(id) on delete set null;
-- At most one LIVE credit payment per deposit. Reverse nulls source_deposit_id
-- on the refunded row (see reverse_deposit_credit), freeing the slot so a
-- re-paid deposit can be credited again.
create unique index if not exists uniq_payments_source_deposit
  on public.payments(source_deposit_id) where source_deposit_id is not null;

alter table public.invoices
  add column if not exists deposit_credited_cents integer not null default 0;

-- ── RPC: credit a paid deposit to an invoice (idempotent) ──────────────────
create or replace function public.credit_deposit_to_invoice(_deposit_id uuid, _invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _dep record; _inv record; _apply integer; _pid uuid;
begin
  select id, organization_id, amount_cents, status, currency, invoice_id
    into _dep from public.deposits where id = _deposit_id for update;
  if _dep.id is null then return; end if;
  if _dep.status <> 'paid' then return; end if;
  if coalesce(_dep.amount_cents, 0) <= 0 then return; end if;

  select id, organization_id, currency, status, total_cents, amount_paid_cents
    into _inv from public.invoices where id = _invoice_id and deleted_at is null for update;
  if _inv.id is null then return; end if;
  if _inv.status = 'void' then return; end if;  -- never credit a voided invoice

  if _dep.organization_id <> _inv.organization_id then
    raise exception 'credit_deposit_to_invoice: org mismatch (deposit % / invoice %)', _deposit_id, _invoice_id;
  end if;
  if lower(_dep.currency) <> lower(_inv.currency::text) then
    raise exception 'credit_deposit_to_invoice: currency mismatch (% vs %)', _dep.currency, _inv.currency;
  end if;

  -- Idempotency: a LIVE credit already exists (reversed rows have source_deposit_id nulled).
  if exists (select 1 from public.payments where source_deposit_id = _deposit_id) then
    update public.deposits set invoice_id = _invoice_id where id = _deposit_id and invoice_id is null;
    return;
  end if;

  -- Cap the credit at the invoice's remaining balance; the remainder (if the
  -- deposit exceeds the bill) stays on the deposit, to be refunded/forfeited.
  _apply := least(_dep.amount_cents, greatest(0, _inv.total_cents - _inv.amount_paid_cents));
  if _apply <= 0 then
    update public.deposits set invoice_id = _invoice_id where id = _deposit_id and invoice_id is null;
    return;
  end if;

  insert into public.payments (invoice_id, organization_id, amount_cents, currency, method, status, source_deposit_id, processed_at)
  values (_invoice_id, _inv.organization_id, _apply, _inv.currency, 'in_person'::payment_method_enum, 'succeeded'::payment_status, _deposit_id, now())
  on conflict (source_deposit_id) where source_deposit_id is not null do nothing
  returning id into _pid;
  if _pid is null then return; end if;

  update public.invoices
  set amount_paid_cents      = amount_paid_cents + _apply,
      deposit_credited_cents = deposit_credited_cents + _apply,
      balance_due_cents      = greatest(0, total_cents - (amount_paid_cents + _apply)),
      status = case
                 when status in ('void','paid') then status
                 when amount_paid_cents + _apply >= total_cents then 'paid'::invoice_status
                 when amount_paid_cents + _apply > 0 then 'partial'::invoice_status
                 else status end,
      paid_at = case
                  when status in ('void','paid') then paid_at
                  when amount_paid_cents + _apply >= total_cents then now()
                  else paid_at end
  where id = _invoice_id;

  update public.deposits set invoice_id = _invoice_id where id = _deposit_id;
end; $$;

-- ── RPC: reverse a deposit credit (on refund) ──────────────────────────────
create or replace function public.reverse_deposit_credit(_deposit_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _pay record; _inv record;
begin
  -- Lock the deposit first so a concurrent credit/reverse can't interleave.
  perform 1 from public.deposits where id = _deposit_id for update;

  select id, invoice_id, amount_cents, status into _pay
    from public.payments where source_deposit_id = _deposit_id for update;
  if _pay.id is null then return; end if;          -- never credited (or already reversed → nulled)
  if _pay.status = 'refunded' then return; end if;

  select id, total_cents, amount_paid_cents, status into _inv
    from public.invoices where id = _pay.invoice_id for update;

  -- Mark the credit refunded and DETACH it (frees the unique slot for a re-credit).
  update public.payments
    set status = 'refunded'::payment_status, refund_amount_cents = _pay.amount_cents,
        refunded_at = now(), source_deposit_id = null
    where id = _pay.id;

  if _inv.id is null then return; end if;  -- invoice gone; nothing to adjust

  update public.invoices
  set amount_paid_cents      = greatest(0, amount_paid_cents - _pay.amount_cents),
      deposit_credited_cents = greatest(0, deposit_credited_cents - _pay.amount_cents),
      balance_due_cents      = greatest(0, total_cents - greatest(0, amount_paid_cents - _pay.amount_cents)),
      status = case
                 when status = 'void' then status
                 when greatest(0, amount_paid_cents - _pay.amount_cents) >= total_cents then 'paid'::invoice_status
                 when greatest(0, amount_paid_cents - _pay.amount_cents) > 0 then 'partial'::invoice_status
                 else 'sent'::invoice_status end,
      -- Clear a stale paid timestamp when the reversal drops the invoice below total
      -- (else paid_at-keyed revenue/tax reports over-count).
      paid_at = case
                  when status = 'void' then paid_at
                  when greatest(0, amount_paid_cents - _pay.amount_cents) >= total_cents then paid_at
                  else null end
  where id = _inv.id;
end; $$;

grant execute on function public.credit_deposit_to_invoice(uuid, uuid) to service_role;
grant execute on function public.reverse_deposit_credit(uuid) to service_role;

notify pgrst, 'reload schema';
