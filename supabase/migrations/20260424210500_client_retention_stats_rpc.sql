-- client_retention_stats: server-side retention calculation.
--
-- The client-side version in src/hooks/useClientAnalytics.ts fetched up to
-- 5000 prior owners and up to 10000 reservations to compute "owners created
-- before the range who returned within 30/60/90 days". That silently
-- truncated large orgs (only 1000 owners' reservations were actually
-- queried) and shipped a lot of data over the wire for no good reason.
--
-- This RPC does the whole thing in SQL in one round-trip. Scoped to the
-- caller's org via is_org_member.

CREATE OR REPLACE FUNCTION public.client_retention_stats(
  _org_id uuid,
  _range_from timestamptz
) RETURNS TABLE(
  retention30 numeric,
  retention60 numeric,
  retention90 numeric,
  total_prior_owners integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_org_member(_org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;

  RETURN QUERY
  WITH prior_owners AS (
    SELECT id, created_at
    FROM public.owners
    WHERE organization_id = _org_id
      AND deleted_at IS NULL
      AND created_at < _range_from
  ),
  first_return AS (
    SELECT
      o.id AS owner_id,
      o.created_at AS joined_at,
      (
        SELECT MIN(r.start_at)
        FROM public.reservations r
        WHERE r.primary_owner_id = o.id
          AND r.organization_id = _org_id
          AND r.status NOT IN ('cancelled','no_show')
          AND r.deleted_at IS NULL
          AND r.start_at > o.created_at
      ) AS first_visit_at
    FROM prior_owners o
  ),
  stats AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE first_visit_at IS NOT NULL
          AND first_visit_at <= joined_at + interval '30 days'
      ) AS r30,
      COUNT(*) FILTER (
        WHERE first_visit_at IS NOT NULL
          AND first_visit_at <= joined_at + interval '60 days'
      ) AS r60,
      COUNT(*) FILTER (
        WHERE first_visit_at IS NOT NULL
          AND first_visit_at <= joined_at + interval '90 days'
      ) AS r90
    FROM first_return
  )
  SELECT
    CASE WHEN total > 0 THEN (r30::numeric / total) * 100 ELSE 0 END,
    CASE WHEN total > 0 THEN (r60::numeric / total) * 100 ELSE 0 END,
    CASE WHEN total > 0 THEN (r90::numeric / total) * 100 ELSE 0 END,
    total::integer
  FROM stats;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.client_retention_stats(uuid, timestamptz)
  TO authenticated;
