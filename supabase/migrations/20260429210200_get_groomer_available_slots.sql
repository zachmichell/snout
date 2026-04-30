-- Migration: get_groomer_available_slots
--
-- Pet-parent–facing RPC: given a groomer + date + appointment duration,
-- return just the start times that are open. The function is SECURITY
-- DEFINER and authorizes the caller against `is_org_member()`, so we don't
-- have to grant broad SELECT on `grooming_appointments` to customers
-- (preserves customer privacy — parents only see slot times, not who else
-- is booked).
--
-- Inputs:
--   p_groomer_id         the groomer to query
--   p_date               yyyy-mm-dd in the org's timezone
--   p_duration_minutes   how long the appointment will take (NULL → 60)
--   p_slot_step_minutes  granularity (NULL → 15)
--
-- Returns: jsonb { "slots": ["09:00", "09:15", ...] }
-- Returns empty slots array (not error) when:
--   • groomer doesn't work that day (no working_hours row)
--   • groomer is at max_appointments_per_day for that date
--   • no candidate window fits the requested duration
--
-- v2 will extend this to:
--   • per-groomer time matrix (size × level → minutes) overrides
--   • date-specific overrides (groomer takes Friday off this week)
--   • intake stagger preferences (morning style, daily stagger)
--   • end-of-day safeguard (don't book Level 3/4 last)

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
  v_dow integer;
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
  -- 1. Confirm the groomer exists, is active, and we (auth.uid()) are in
  --    the same org.
  SELECT g.organization_id, g.max_appointments_per_day
    INTO v_org_id, v_max_per_day
  FROM public.groomers g
  WHERE g.id = p_groomer_id AND g.status = 'active';

  IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  -- 2. Cap the step / duration to sane bounds so callers can't make us
  --    iterate forever or zero-step.
  v_step_min := GREATEST(5, LEAST(v_step_min, 240));
  v_duration_min := GREATEST(5, LEAST(v_duration_min, 600));

  -- 3. Working hours for this day-of-week. No row = doesn't work today.
  v_dow := EXTRACT(DOW FROM p_date)::int;
  SELECT start_time, end_time
    INTO v_start, v_end
  FROM public.groomer_working_hours
  WHERE groomer_id = p_groomer_id AND day_of_week = v_dow;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  -- 4. Pull the groomer's existing non-cancelled appointments for the date.
  --    We need both start_time and duration so we can compute end-time and
  --    detect overlaps with each candidate window.
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

  -- 5. Daily appointment cap. If the groomer is already at their max,
  --    return zero slots regardless of clock-time availability.
  IF v_existing_count >= v_max_per_day THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb);
  END IF;

  -- 6. Walk candidate start times in v_step_min increments. A candidate is
  --    valid if (candidate, candidate + duration) fits inside [v_start,
  --    v_end] and doesn't overlap any existing appointment.
  v_candidate := v_start;
  WHILE (v_candidate + (v_duration_min * interval '1 minute'))::time <= v_end LOOP
    v_candidate_end := (v_candidate + (v_duration_min * interval '1 minute'))::time;

    v_overlaps := FALSE;
    IF array_length(v_existing_starts, 1) IS NOT NULL THEN
      FOR i IN 1..array_length(v_existing_starts, 1) LOOP
        v_existing_end := (v_existing_starts[i] + (v_existing_durations[i] * interval '1 minute'))::time;
        -- Two intervals overlap iff each starts before the other ends.
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
