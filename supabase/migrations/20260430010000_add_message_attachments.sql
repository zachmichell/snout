-- Migration: add_message_attachments
--
-- Adds attachment support to chat messages. Two changes:
--
-- 1. messages.attachments jsonb column (NOT NULL DEFAULT '[]'::jsonb)
--    Each element is a self-describing object:
--      {
--        "url":        text,    -- public/signed URL we render from
--        "path":       text,    -- storage object path (for delete/regen)
--        "mime_type":  text,    -- "image/jpeg" | "application/pdf" | …
--        "size_bytes": integer, -- raw file size for display
--        "name":       text,    -- original filename
--        "kind":       text     -- "image" | "document" — render hint
--      }
--    body stays NOT NULL; for attachment-only sends we write empty string.
--    Storing the array on the message keeps the read path simple — the
--    web hook and iOS list views already select messages.* and now get
--    attachments along for free.
--
-- 2. New `message-attachments` storage bucket, private (NOT public read),
--    org-scoped via the same `is_org_member((storage.foldername)[1])` trick
--    pet-photos uses. Path convention is
--      {organization_id}/{conversation_id}/{timestamp}-{name}.{ext}
--    Read access is org-only because messages can contain sensitive info
--    (vet records, photos, billing PDFs).
--
-- Reversal note: the column add is reversible (DROP COLUMN attachments),
-- but the bucket + storage policies need explicit teardown if reverting.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.messages.attachments IS
  'Array of {url, path, mime_type, size_bytes, name, kind} objects. kind is "image" or "document".';

-- Create the bucket. INSERT IF NOT EXISTS pattern via ON CONFLICT.
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Org-scoped read: only members of the org owning the file's path prefix
-- can SELECT objects. Path is {org_id}/{conv_id}/{file}, so foldername[1]
-- is the org_id.
DROP POLICY IF EXISTS "Message attachments org read" ON storage.objects;
CREATE POLICY "Message attachments org read"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'message-attachments'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Message attachments org insert" ON storage.objects;
CREATE POLICY "Message attachments org insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'message-attachments'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Message attachments org update" ON storage.objects;
CREATE POLICY "Message attachments org update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'message-attachments'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Message attachments org delete" ON storage.objects;
CREATE POLICY "Message attachments org delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'message-attachments'
  AND public.is_org_member(((storage.foldername(name))[1])::uuid)
);
