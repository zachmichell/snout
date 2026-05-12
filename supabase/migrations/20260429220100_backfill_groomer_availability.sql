-- Migration: backfill_groomer_availability
--
-- Project the existing `groomer_working_hours` template rows forward 90 days
-- into `groomer_availability` so groomers who already had a template don't
-- lose their schedule when the slot RPC switches over.
--
-- For each (groomer_id, day_of_week, start, end) row, generate every date in
-- [today, today + 90 days] whose weekday matches and insert one availability
-- row. Idempotent via ON CONFLICT — re-running this migration on an org that
-- has been customizing per-date hours is a no-op (existing rows win).

INSERT INTO public.groomer_availability (groomer_id, date, start_time, end_time)
SELECT
  wh.groomer_id,
  d::date AS date,
  wh.start_time,
  wh.end_time
FROM public.groomer_working_hours wh
CROSS JOIN generate_series(
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '90 days',
  INTERVAL '1 day'
) AS d
WHERE EXTRACT(DOW FROM d)::smallint = wh.day_of_week
ON CONFLICT (groomer_id, date) DO NOTHING;
