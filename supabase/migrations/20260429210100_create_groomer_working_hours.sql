-- Migration: create_groomer_working_hours
--
-- Per-groomer working hours by day-of-week. A row says "this groomer works
-- start_time → end_time on day_of_week". Missing row for a day = groomer
-- doesn't work that day.
--
-- This replaces the legacy `groomers.working_days` text-array as the source
-- of truth for *when* a groomer is available — `working_days` will eventually
-- be derived from this table or removed. For v1 we leave `working_days` in
-- place to avoid breaking any other consumer; if both disagree, this table
-- wins (the slot function reads from here, not from `working_days`).
--
-- Per-date overrides (e.g. "off this Friday", "working late this Tuesday")
-- are deferred to v2; this v1 only models the per-day-of-week template.

CREATE TABLE IF NOT EXISTS public.groomer_working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  groomer_id uuid NOT NULL REFERENCES public.groomers(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- 0 = Sunday, 1 = Monday, ..., 6 = Saturday. Matches Postgres EXTRACT(DOW)
  -- and JavaScript Date.getDay().
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT groomer_working_hours_end_after_start CHECK (end_time > start_time),
  CONSTRAINT groomer_working_hours_one_row_per_day UNIQUE (groomer_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_groomer_working_hours_lookup
  ON public.groomer_working_hours (groomer_id, day_of_week);

ALTER TABLE public.groomer_working_hours ENABLE ROW LEVEL SECURITY;

-- Pet parents (and any org member) can read working hours so the booking
-- wizard can show "Tuesdays only" / "9–5 weekdays". Write access is gated to
-- staff-level roles via `is_org_admin`, matching the staff_shifts pattern.
DROP POLICY IF EXISTS "groomer_working_hours_select" ON public.groomer_working_hours;
CREATE POLICY "groomer_working_hours_select"
  ON public.groomer_working_hours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_working_hours.groomer_id
        AND public.is_org_member(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_working_hours_insert" ON public.groomer_working_hours;
CREATE POLICY "groomer_working_hours_insert"
  ON public.groomer_working_hours FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_working_hours.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_working_hours_update" ON public.groomer_working_hours;
CREATE POLICY "groomer_working_hours_update"
  ON public.groomer_working_hours FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_working_hours.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_working_hours_delete" ON public.groomer_working_hours;
CREATE POLICY "groomer_working_hours_delete"
  ON public.groomer_working_hours FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_working_hours.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION public.tg_groomer_working_hours_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groomer_working_hours_set_updated_at ON public.groomer_working_hours;
CREATE TRIGGER groomer_working_hours_set_updated_at
BEFORE UPDATE ON public.groomer_working_hours
FOR EACH ROW EXECUTE FUNCTION public.tg_groomer_working_hours_set_updated_at();
