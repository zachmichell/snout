-- Broadcast a single staff message to every enrolled owner of a class
-- instance OR a whole series. Each owner receives it in their own 1:1
-- conversation (created if needed); replies stay private to staff. Reuses
-- the existing handle_new_message() trigger for last-message/unread bumps.
-- SECURITY DEFINER so it can fan out across conversations, but it authorizes
-- the caller via is_org_staff() on the class's org and stamps auth.uid() as
-- the sender.
CREATE OR REPLACE FUNCTION public.broadcast_class_message(
    p_body text,
    p_class_instance_id uuid DEFAULT NULL,
    p_series_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
    v_sender uuid := auth.uid();
    v_count int := 0;
    v_conv uuid;
    r record;
BEGIN
    IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
        RAISE EXCEPTION 'Message body is required';
    END IF;
    IF (p_class_instance_id IS NULL) = (p_series_id IS NULL) THEN
        RAISE EXCEPTION 'Provide exactly one of class instance or series';
    END IF;

    IF p_class_instance_id IS NOT NULL THEN
        SELECT organization_id INTO v_org FROM class_instances WHERE id = p_class_instance_id;
    ELSE
        SELECT organization_id INTO v_org FROM class_series WHERE id = p_series_id;
    END IF;
    IF v_org IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
    IF NOT is_org_staff(v_org) THEN RAISE EXCEPTION 'Not authorized'; END IF;

    FOR r IN
        SELECT DISTINCT e.owner_id
        FROM class_enrollments e
        WHERE e.status <> 'cancelled'
          AND ( (p_class_instance_id IS NOT NULL AND e.class_instance_id = p_class_instance_id)
             OR (p_series_id IS NOT NULL AND e.series_id = p_series_id) )
    LOOP
        SELECT id INTO v_conv
        FROM conversations
        WHERE organization_id = v_org AND owner_id = r.owner_id
        ORDER BY created_at
        LIMIT 1;

        IF v_conv IS NULL THEN
            INSERT INTO conversations (organization_id, owner_id)
            VALUES (v_org, r.owner_id)
            RETURNING id INTO v_conv;
        END IF;

        INSERT INTO messages (conversation_id, sender_type, sender_id, body)
        VALUES (v_conv, 'staff', v_sender, btrim(p_body));

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_class_message(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broadcast_class_message(text, uuid, uuid) TO authenticated;
