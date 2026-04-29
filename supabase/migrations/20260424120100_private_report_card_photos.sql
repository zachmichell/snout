-- Make report-card-photos bucket private; require org membership or
-- owner-of-pet (with published report card) for SELECT. Also backfill
-- report_cards.photo_urls so entries are bare bucket paths, not full
-- public URLs — signed URLs are generated on demand client-side.

UPDATE storage.buckets SET public = false WHERE id = 'report-card-photos';

DROP POLICY IF EXISTS "Public read report card photos" ON storage.objects;

-- Staff of the org that owns the file. Path layout is
-- <org_id>/<pet_id>/<reservation_id>/<filename>, so org id is segment 1.
CREATE POLICY "Org members read report card photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'report-card-photos'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);

-- Pet owners: allowed only when the matching report card is published and
-- the caller is linked to the pet via pet_owners/owners. Segments 2 and 3
-- give pet_id and reservation_id respectively.
CREATE POLICY "Owners read published report card photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'report-card-photos'
  AND EXISTS (
    SELECT 1
    FROM public.report_cards rc
    JOIN public.pet_owners po ON po.pet_id = rc.pet_id
    JOIN public.owners o      ON o.id = po.owner_id
    WHERE rc.pet_id         = ((storage.foldername(name))[2])::uuid
      AND rc.reservation_id = ((storage.foldername(name))[3])::uuid
      AND rc.published = true
      AND o.profile_id = auth.uid()
  )
);

-- Backfill: strip the public-URL prefix so each entry is a bare path.
-- Example: https://<proj>.supabase.co/storage/v1/object/public/report-card-photos/<path>
-- becomes: <path>
UPDATE public.report_cards
SET photo_urls = ARRAY(
  SELECT regexp_replace(
    u,
    '^https?://[^/]+/storage/v1/object/public/report-card-photos/',
    ''
  )
  FROM unnest(photo_urls) AS u
)
WHERE photo_urls IS NOT NULL
  AND array_length(photo_urls, 1) > 0
  AND EXISTS (
    SELECT 1 FROM unnest(photo_urls) AS u
    WHERE u LIKE 'http%/storage/v1/object/public/report-card-photos/%'
  );
