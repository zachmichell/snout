-- 6.4.5c: Tax calculation engine.
alter table public.invoice_lines
  add column if not exists qbo_tax_code_id uuid
    references public.qbo_tax_codes(id) on delete set null,
  add column if not exists tax_cents integer not null default 0,
  add column if not exists tax_breakdown jsonb;

create index if not exists idx_invoice_lines_qbo_tax_code
  on public.invoice_lines (qbo_tax_code_id)
  where qbo_tax_code_id is not null;

create or replace function public.resolve_line_tax_code(_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    l.qbo_tax_code_id,
    (select s.qbo_tax_code_id from public.services s where s.id = l.service_id),
    null
  )
  from public.invoice_lines l
  where l.id = _line_id;
$$;

revoke all on function public.resolve_line_tax_code(uuid) from public;

create or replace function public.recalculate_invoice_taxes(_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _org uuid;
  _subtotal integer := 0;
  _tax integer := 0;
  _existing_discount integer := 0;
  _existing_credit integer := 0;
begin
  select organization_id,
         coalesce(promotion_discount_cents, 0),
         coalesce(store_credit_applied_cents, 0)
    into _org, _existing_discount, _existing_credit
  from public.invoices
  where id = _invoice_id;

  if _org is null then
    raise exception 'recalculate_invoice_taxes: invoice % not found', _invoice_id;
  end if;

  with line_codes as (
    select
      l.id as line_id,
      l.line_total_cents,
      coalesce(l.qbo_tax_code_id, s.qbo_tax_code_id) as effective_code_id
    from public.invoice_lines l
    left join public.services s on s.id = l.service_id
    where l.invoice_id = _invoice_id
  ),
  line_breakdown as (
    select
      lc.line_id,
      lc.line_total_cents,
      lc.effective_code_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'qbo_tax_rate_id', r.id,
            'rate_name', r.name,
            'rate_basis_points', r.rate_basis_points,
            'amount_cents', round((lc.line_total_cents::numeric * r.rate_basis_points::numeric) / 10000)::int
          )
          order by r.name
        ) filter (where r.id is not null),
        '[]'::jsonb
      ) as breakdown,
      coalesce(
        sum(round((lc.line_total_cents::numeric * r.rate_basis_points::numeric) / 10000)::int),
        0
      ) as line_tax_cents
    from line_codes lc
    left join public.qbo_tax_code_rates cr on cr.tax_code_id = lc.effective_code_id
    left join public.qbo_tax_rates r on r.id = cr.tax_rate_id and r.active = true
    group by lc.line_id, lc.line_total_cents, lc.effective_code_id
  )
  update public.invoice_lines l
    set tax_cents = lb.line_tax_cents,
        tax_breakdown = lb.breakdown
    from line_breakdown lb
    where l.id = lb.line_id;

  select coalesce(sum(line_total_cents), 0),
         coalesce(sum(tax_cents), 0)
    into _subtotal, _tax
  from public.invoice_lines
  where invoice_id = _invoice_id;

  update public.invoices
    set subtotal_cents = _subtotal,
        tax_cents = _tax,
        total_cents = greatest(0, _subtotal + _tax - _existing_discount - _existing_credit)
    where id = _invoice_id;

  delete from public.invoice_taxes where invoice_id = _invoice_id;

  insert into public.invoice_taxes (
    organization_id, invoice_id, name, rate_basis_points, amount_cents
  )
  select
    _org,
    _invoice_id,
    c.name,
    coalesce(sum(r.rate_basis_points), 0)::int,
    sum(round((l.line_total_cents::numeric * r.rate_basis_points::numeric) / 10000)::int)::int
  from public.invoice_lines l
  join public.qbo_tax_code_rates cr
    on cr.tax_code_id = coalesce(l.qbo_tax_code_id,
        (select s.qbo_tax_code_id from public.services s where s.id = l.service_id))
  join public.qbo_tax_codes c on c.id = cr.tax_code_id
  join public.qbo_tax_rates r on r.id = cr.tax_rate_id and r.active = true
  where l.invoice_id = _invoice_id
  group by c.id, c.name
  having sum(round((l.line_total_cents::numeric * r.rate_basis_points::numeric) / 10000)::int) <> 0;
end;
$fn$;

revoke all on function public.recalculate_invoice_taxes(uuid) from public;
grant execute on function public.recalculate_invoice_taxes(uuid) to service_role;
grant execute on function public.recalculate_invoice_taxes(uuid) to authenticated;

-- Trigger: keep per-invoice totals fresh whenever a line moves.
-- Recursion guard via pg_trigger_depth() stops the recalc UPDATE from
-- re-firing the trigger.
create or replace function public.tg_invoice_lines_recalc_taxes()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _invoice uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  _invoice := coalesce(new.invoice_id, old.invoice_id);
  if _invoice is not null then
    perform public.recalculate_invoice_taxes(_invoice);
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_invoice_lines_recalc_taxes on public.invoice_lines;
create trigger trg_invoice_lines_recalc_taxes
  after insert or update or delete on public.invoice_lines
  for each row
  execute function public.tg_invoice_lines_recalc_taxes();
