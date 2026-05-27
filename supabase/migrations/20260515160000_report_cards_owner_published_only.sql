-- Tighten owner visibility on report_cards to PUBLISHED cards only.
--
-- Two owner-scoped SELECT policies existed:
--   * "Owners read published cards"  — published = true AND owns the pet
--   * "Owner report_cards read"      — owns the pet (ANY status, incl. drafts)
-- Being PERMISSIVE (OR'd), the broader one let owners read staff's
-- work-in-progress drafts for their own pets. The owner portal / iOS only
-- ever query published cards, so dropping the broad policy changes nothing
-- the apps rely on and stops draft leakage. Staff retain full access via the
-- is_org_staff tenant-isolation policy.

DROP POLICY IF EXISTS "Owner report_cards read" ON public.report_cards;
