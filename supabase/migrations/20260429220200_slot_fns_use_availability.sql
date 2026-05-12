-- Migration: slot_fns_use_availability
--
-- Two changes:
--
-- 1. `get_groomer_available_slots` now reads working hours from the new
--    `groomer_availability` table (per-date) instead of `groomer_working_hours`
--    (per day-of-week template). Same signature, same return shape — callers
--    don't need to change.
--
-- 2. New RPC `get_groomer_available_dates` returns the dates between
--    `p_start_date` and `p_end_date` that the groomer has any availability
--    row for. The iOS calendar grid uses this to grey out days the groomer
--    isn't working, so users can't pick non-working dates.

CREATE OR REPLACE FUNCTION public.get_groomer_available_slots(
  p_groomer_id uuid,
  p_date date,
  p_duration_minutes integer DEFAULT NULL,
  p_slot_step_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_max_per_day integer;
  v_start time;
  v_end time;
  v_duration_min integer := COALESCE(p_duration_minutes, 60);
  v_step_min integer := COALESCE(p_slot_step_minutes, 15);
  v_existing_starts time[];
  v_existing_durations integer[];
  v_existing_count integer;
  v_candidate time;
  v_candidate_end time;
  v_overlaps boolean;
  v_existing_end time;
  v_slots jsonb := '[]'::jsonb;
  i integer;
BEGIN
  SELECT g.organization_id, g.max_appointments_per_day
    INTO v_org_id, v_max_per_day
  FROM public.groomers g
  WHERE g.id = p_groomer_id AND g.status = 'active';

  IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  v_step_min := GREATEST(5, LEAST(v_step_min, 240));
  v_duration_min := GREATEST(5, LEAST(v_duration_min, 600));

  -- New: read working hours from per-date availability, not per-DOW template.
  SELECT start_time, end_time
    INTO v_start, v_end
  FROM public.groomer_availability
  WHERE groomer_id = p_groomer_id AND date = p_date;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  SELECT
    array_agg(start_time ORDER BY start_time),
    array_agg(estimated_duration_minutes ORDER BY start_time),
    COUNT(*)
    INTO v_existing_starts, v_existing_durations, v_existing_count
  FROM public.grooming_appointments
  WHERE groomer_id = p_groomer_id
    AND appointment_date = p_date
    AND status NOT IN ('cancelled', 'no_show');

  v_existing_starts    := COALESCE(v_existing_starts, ARRAY[]::time[]);
  v_existing_durations := COALESCE(v_existing_durations, ARRAY[]::integer[]);
  v_existing_count     := COALESCE(v_existing_count, 0);

  IF v_existing_count >= v_max_per_day THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  v_candidate := v_start;
  WHILE (v_candidate + (v_duration_min * interval '1 minute'))::time <= v_end LOOP
    v_candidate_end := (v_candidate + (v_duration_min * interval '1 minute'))::time;

    v_overlaps := FALSE;
    IF array_length(v_existing_starts, 1) IS NOT NULL THEN
      FOR i IN 1..array_length(v_existing_starts, 1) LOOP
        v_existing_end := (v_existing_starts[i] + (v_existing_durations[i] * interval '1 minute'))::time;
        IF v_candidate < v_existing_end AND v_candidate_end > v_existing_starts[i] THEN
          v_overlaps := TRUE;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF NOT v_overlaps THEN
      v_slots := v_slots || to_jsonb(to_char(v_candidate, 'HH24:MI'));
    END IF;

    v_candidate := (v_candidate + (v_step_min * interval '1 minute'))::time;
  END LOOP;

  RETURN jsonb_build_object('slots', v_slots);
END;
$$;

REVOKE ALL ON FUNCTION public.get_groomer_available_slots(uuid, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_groomer_available_slots(uuid, date, integer, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_groomer_available_dates(
  p_groomer_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_dates date[];
BEGIN
  SELECT g.organization_id INTO v_org_id
  FROM public.groomers g
  WHERE g.id = p_groomer_id AND g.status = 'active';

  IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('dates', '[]'::jsonb);
  END IF;

  -- Cap the range so a misbehaving caller can't pull a year of rows.
  IF (p_end_date - p_start_date) > 366 THEN
    RETURN jsonb_build_object('dates', '[]'::jsonb);
  END IF;

  SELECT array_agg(date::text ORDER BY date)
    INTO v_dates
  FROM public.groomer_availability
  WHERE groomer_id = p_groomer_id
    AND date BETWEEN p_start_date AND p_end_date;

  RETURN jsonb_build_object('dates', COALESCE(to_jsonb(v_dates), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_groomer_available_dates(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_groomer_available_dates(uuid, date, date) TO authenticated;
