-- Tighten pet-photos bucket listing. Advisor lint 0025 flagged the
-- "Public read pet photos" SELECT policy as allowing clients to list all
-- files across tenants.
--
-- Scope of THIS migration (narrow):
--   - Drop the bucket-wide SELECT policy.
--   - Add an org-scoped SELECT so staff can still .list() their own org's
--     photos (path layout is <org_id>/<pet_id>/<filename>).
--
-- NOT addressed here (tracked as follow-up 2b):
--   - Bucket remains public=true so existing pets.photo_url values
--     (full public URLs stored across the app) keep rendering without
--     code changes. Cross-tenant DIRECT URL access is still possible if
--     the URL is known. The full privacy fix mirrors what
--     20260424130500-era report-card-photos does: flip bucket private,
--     backfill photo_url to bare paths, resolve signed URLs in every
--     display site. That's a ~15-file refactor and deserves its own
--     dedicated task.

DROP POLICY IF EXISTS "Public read pet photos" ON storage.objects;

CREATE POLICY "Org members read pet photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'pet-photos'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);
