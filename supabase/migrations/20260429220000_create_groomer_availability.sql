-- Migration: create_groomer_availability
--
-- Replaces the day-of-week template (`groomer_working_hours`) with a per-date
-- availability model. One row = "this groomer is working on this specific
-- date, these hours". Missing row = not available.
--
-- Why per-date: groomers don't work the same days every week. Vacations,
-- swaps, off-weekends-one-month-on-the-next — a template can't represent it.
-- The calendar UI on web (GroomerAvailabilityDialog) writes directly to this
-- table; the iOS slot picker reads from it via `get_groomer_available_slots`
-- and `get_groomer_available_dates`.
--
-- We *keep* `groomer_working_hours` in place for now to avoid breaking any
-- consumer that hasn't been updated yet, but the slot RPC stops reading it
-- in the next migration. A separate later migration will drop it.

CREATE TABLE IF NOT EXISTS public.groomer_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  groomer_id uuid NOT NULL REFERENCES public.groomers(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT groomer_availability_end_after_start CHECK (end_time > start_time),
  CONSTRAINT groomer_availability_one_per_date UNIQUE (groomer_id, date)
);

CREATE INDEX IF NOT EXISTS idx_groomer_availability_lookup
  ON public.groomer_availability (groomer_id, date);

ALTER TABLE public.groomer_availability ENABLE ROW LEVEL SECURITY;

-- Org members can read availability (so the booking wizard works for parents).
-- Org admins can manage rows (so staff/groomers can edit the calendar).
DROP POLICY IF EXISTS "groomer_availability_select" ON public.groomer_availability;
CREATE POLICY "groomer_availability_select"
  ON public.groomer_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_availability.groomer_id
        AND public.is_org_member(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_availability_insert" ON public.groomer_availability;
CREATE POLICY "groomer_availability_insert"
  ON public.groomer_availability FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_availability.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_availability_update" ON public.groomer_availability;
CREATE POLICY "groomer_availability_update"
  ON public.groomer_availability FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_availability.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

DROP POLICY IF EXISTS "groomer_availability_delete" ON public.groomer_availability;
CREATE POLICY "groomer_availability_delete"
  ON public.groomer_availability FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.groomers g
      WHERE g.id = groomer_availability.groomer_id
        AND public.is_org_admin(g.organization_id)
    )
  );

-- Reuse the updated_at trigger function from the working_hours migration.
DROP TRIGGER IF EXISTS groomer_availability_set_updated_at ON public.groomer_availability;
CREATE TRIGGER groomer_availability_set_updated_at
BEFORE UPDATE ON public.groomer_availability
FOR EACH ROW EXECUTE FUNCTION public.tg_groomer_working_hours_set_updated_at();
