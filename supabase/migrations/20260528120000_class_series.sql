-- Class series: a multi-week course (e.g. "Puppy Kindergarten — 6 Tuesdays").
-- A series groups the weekly class_instances and lets a pet enroll in the whole
-- course at once: enrolling inserts one class_enrollments row per session (all
-- tagged with series_id), so per-session attendance reuses the existing
-- class_enrollments.attended column. Standalone sessions/enrollments keep
-- series_id NULL and behave exactly as before.

CREATE TABLE IF NOT EXISTS public.class_series (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    class_type_id uuid NOT NULL REFERENCES public.class_types(id) ON DELETE CASCADE,
    location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
    instructor_user_id uuid,
    title text,
    start_date date NOT NULL,
    session_count integer NOT NULL CHECK (session_count >= 1 AND session_count <= 52),
    weekday smallint CHECK (weekday BETWEEN 0 AND 6),
    start_time time NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.class_instances
    ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.class_series(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS session_number integer;

ALTER TABLE public.class_enrollments
    ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.class_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_class_series_org ON public.class_series(organization_id);
CREATE INDEX IF NOT EXISTS idx_class_instances_series ON public.class_instances(series_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_series ON public.class_enrollments(series_id);

-- updated_at maintenance (self-contained function).
CREATE OR REPLACE FUNCTION public.tg_class_series_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS class_series_set_updated_at ON public.class_series;
CREATE TRIGGER class_series_set_updated_at
    BEFORE UPDATE ON public.class_series
    FOR EACH ROW EXECUTE FUNCTION public.tg_class_series_set_updated_at();

-- RLS mirrors class_instances/class_types: org members read; pet parents read
-- active series in their org; staff write.
ALTER TABLE public.class_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation select" ON public.class_series;
CREATE POLICY "Tenant isolation select" ON public.class_series
    FOR SELECT USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Owners read active series" ON public.class_series;
CREATE POLICY "Owners read active series" ON public.class_series
    FOR SELECT USING (
        status = 'active' AND EXISTS (
            SELECT 1 FROM owners o
            WHERE o.organization_id = class_series.organization_id
              AND o.profile_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Tenant isolation insert" ON public.class_series;
CREATE POLICY "Tenant isolation insert" ON public.class_series
    FOR INSERT WITH CHECK (is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation update" ON public.class_series;
CREATE POLICY "Tenant isolation update" ON public.class_series
    FOR UPDATE USING (is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.class_series;
CREATE POLICY "Tenant isolation delete" ON public.class_series
    FOR DELETE USING (is_org_staff(organization_id));
