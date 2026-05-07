-- 6.4b: Allow multiple QBO entity mappings per Snout entity, scoped by
-- qbo_entity_type. A refunded Snout payment maps to BOTH:
--   - one QBO Payment (so the original invoice stays paid)
--   - one QBO RefundReceipt (recording the money returned to the customer)
--
-- The prior unique index `qbo_mappings_one_per_snout_entity` is on
-- (organization_id, snout_table, snout_id) only, which blocks the
-- second row. Replace it with one that also includes qbo_entity_type
-- so each (snout_entity, qbo_entity_type) pair can exist independently.
--
-- Idempotent: drop-then-create. Safe to re-run.

drop index if exists public.qbo_mappings_one_per_snout_entity;

create unique index qbo_mappings_one_per_snout_entity_qbo_type
  on public.quickbooks_entity_mappings (organization_id, snout_table, snout_id, qbo_entity_type)
  where deleted_at is null;

comment on index public.qbo_mappings_one_per_snout_entity_qbo_type is
  '6.4b: One mapping per (snout_entity, qbo_entity_type) so refunded payments can map to both a Payment and a RefundReceipt. Replaces qbo_mappings_one_per_snout_entity.';
