-- 6.4.5b: One tax code per service / retail product. FK is nullable.
alter table public.services
  add column if not exists qbo_tax_code_id uuid
    references public.qbo_tax_codes(id) on delete set null;

alter table public.retail_products
  add column if not exists qbo_tax_code_id uuid
    references public.qbo_tax_codes(id) on delete set null;

create index if not exists idx_services_qbo_tax_code
  on public.services (qbo_tax_code_id)
  where qbo_tax_code_id is not null;

create index if not exists idx_retail_products_qbo_tax_code
  on public.retail_products (qbo_tax_code_id)
  where qbo_tax_code_id is not null;
