-- 6.6b: Tips Payable account on QBO connection.
--
-- Operator decision: tips post to a liability account ("Tips Payable")
-- because the operator distributes them to staff later. Per tipped
-- transaction, Snout posts a Journal Entry:
--   Debit  Undeposited Funds      (tip amount)
--   Credit Tips Payable           (tip amount)
-- When the operator distributes tips to staff:
--   Debit  Tips Payable
--   Credit Cash / Bank
-- The distribution side is operator-side; Snout doesn't manage payroll.

alter table public.quickbooks_accounts
  add column if not exists default_tips_payable_account_id text,
  add column if not exists default_tips_payable_account_name text;

comment on column public.quickbooks_accounts.default_tips_payable_account_id is
  '6.6b: QBO Liability account where tips accrue until distributed to staff.';
