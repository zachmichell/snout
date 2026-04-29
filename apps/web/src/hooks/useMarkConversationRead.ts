import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Mark all opposite-side messages as read and zero the unread counter when viewing a conversation */
export function useMarkConversationRead(
  conversationId: string | undefined,
  side: "staff" | "owner",
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    (async () => {
      const oppositeSender = side === "staff" ? "owner" : "staff";
      const now = new Date().toISOString();

      // Mark opposite-side messages as read
      await supabase
        .from("messages")
        .update({ read_at: now })
        .eq("conversation_id", conversationId)
        .eq("sender_type", oppositeSender)
        .is("read_at", null);

      // Zero the unread counter
      const update = side === "staff" ? { unread_staff: 0 } : { unread_owner: 0 };
      await supabase.from("conversations").update(update).eq("id", conversationId);

      if (!cancelled) {
        qc.invalidateQueries({ queryKey: ["staff-conversations"] });
        qc.invalidateQueries({ queryKey: ["owner-conversation"] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, side, qc]);
}
