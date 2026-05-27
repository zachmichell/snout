-- Report card templates: facilities define reusable report-card structures
-- (named sections, each with custom fields) that staff apply when authoring
-- a card. Distinct from `report_templates`, which powers the analytics
-- custom-report builder.
--
-- A template's `sections` jsonb is the blank structure:
--   [
--     {
--       "id": "uuid",
--       "title": "Play & Activity",
--       "fields": [
--         { "id": "uuid", "label": "Energy", "type": "rating" },
--         { "id": "uuid", "label": "Favorite activity", "type": "text" },
--         { "id": "uuid", "label": "Nap", "type": "select", "options": ["None","Short","Long"] },
--         { "id": "uuid", "label": "Played well with others", "type": "boolean" }
--       ]
--     }
--   ]
-- Supported field types: text, textarea, select, rating (1–5), boolean.
--
-- When a card is authored from a template, the FILLED sections are snapshotted
-- onto report_cards.custom_sections (title + fields incl. value), so:
--   * owners / iOS render without joining to the template, and
--   * published cards are immune to later template edits.

CREATE TABLE IF NOT EXISTS public.report_card_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name            text NOT NULL,
    description     text,
    sections        jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_default      boolean NOT NULL DEFAULT false,
    active          boolean NOT NULL DEFAULT true,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS report_card_templates_org_idx
    ON public.report_card_templates (organization_id)
    WHERE deleted_at IS NULL;

ALTER TABLE public.report_card_templates ENABLE ROW LEVEL SECURITY;

-- Staff-only management, mirroring report_templates' tenant isolation.
DROP POLICY IF EXISTS "Org members view report card templates" ON public.report_card_templates;
CREATE POLICY "Org members view report card templates"
    ON public.report_card_templates FOR SELECT
    USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members create report card templates" ON public.report_card_templates;
CREATE POLICY "Org members create report card templates"
    ON public.report_card_templates FOR INSERT
    WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members update report card templates" ON public.report_card_templates;
CREATE POLICY "Org members update report card templates"
    ON public.report_card_templates FOR UPDATE
    USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members delete report card templates" ON public.report_card_templates;
CREATE POLICY "Org members delete report card templates"
    ON public.report_card_templates FOR DELETE
    USING (public.is_org_member(organization_id));

-- Report card: which template was used (provenance) + the filled sections.
ALTER TABLE public.report_cards
    ADD COLUMN IF NOT EXISTS template_id uuid
        REFERENCES public.report_card_templates(id) ON DELETE SET NULL;

ALTER TABLE public.report_cards
    ADD COLUMN IF NOT EXISTS custom_sections jsonb;
