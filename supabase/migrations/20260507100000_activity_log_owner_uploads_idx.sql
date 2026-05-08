-- Reliability Batch 2a: support the staff dashboard's "Recent customer
-- uploads" widget with a targeted partial index. The widget filters
-- activity_log by (organization_id, action IN (...), created_at,
-- metadata->>'actor_kind' = 'owner') and orders by created_at desc.
-- A partial covering index keeps the lookup small and lets the planner
-- skip the millions of staff-side rows on busy orgs without touching
-- the broader activity_log indexing strategy.

create index if not exists idx_activity_log_owner_uploads
  on public.activity_log (organization_id, created_at desc)
  where action in ('uploaded', 'photo_uploaded', 'signed')
    and (metadata->>'actor_kind') = 'owner';
