-- Migration: mark_conversation_read
--
-- Purpose: Give the pet-parent client a single, authorized RPC that marks all
-- unread staff messages in a conversation as read AND resets the conversation's
-- `unread_owner` counter — atomically. Without this, the client would have to
-- run two separate UPDATEs (messages + conversations) under RLS, which is both
-- racy (counter could drift) and requires per-table UPDATE policies.
--
-- The function is SECURITY DEFINER so it bypasses RLS internally, but only
-- after verifying that the caller's auth.uid() matches the profile_id of the
-- conversation's linked owner. EXECUTE is granted to `authenticated` only.
--
-- Symmetric staff-side function (`mark_conversation_read_by_staff`) can be
-- added later when the staff messaging UX needs it; this migration covers the
-- pet-parent path that the iOS app exercises today.

CREATE OR REPLACE FUNCTION public.mark_conversation_read_by_owner(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner_profile_id uuid;
  v_messages_marked  integer;
BEGIN
  -- Look up the owner's profile_id for this conversation.
  SELECT o.profile_id
    INTO v_owner_profile_id
  FROM public.conversations c
  JOIN public.owners o ON o.id = c.owner_id
  WHERE c.id = p_conversation_id;

  IF v_owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner_profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized to read this conversation' USING ERRCODE = '42501';
  END IF;

  -- Mark all unread staff messages as read.
  WITH updated AS (
    UPDATE public.messages
    SET read_at = NOW()
    WHERE conversation_id = p_conversation_id
      AND read_at IS NULL
      AND sender_type = 'staff'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_messages_marked FROM updated;

  -- Reset the owner-side counter on the conversation row.
  UPDATE public.conversations
  SET unread_owner = 0
  WHERE id = p_conversation_id
    AND unread_owner <> 0;

  RETURN jsonb_build_object(
    'changed', v_messages_marked > 0,
    'messages_marked', v_messages_marked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read_by_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read_by_owner(uuid) TO authenticated;
