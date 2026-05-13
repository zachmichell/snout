import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MessageAttachment = {
  /** Signed URL minted at send time (TTL is 7 days per the iOS sender). */
  url: string;
  /** "image" or "document" — drives the bubble rendering. */
  kind: "image" | "document";
  /** Original filename for download labels. */
  name: string;
  /** Path within the `message-attachments` storage bucket. Stable; the
   *  `url` is signed off this path and can be re-minted if the signed URL
   *  has expired. */
  path: string;
  /** Original MIME type, e.g. "image/jpeg", "application/pdf". */
  mime_type: string;
  /** File size in bytes; rendered in document chips. */
  size_bytes: number;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: "staff" | "owner";
  sender_id: string;
  body: string;
  attachments: MessageAttachment[] | null;
  read_at: string | null;
  created_at: string;
  sender_profile?: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
};

export function useMessages(conversationId?: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      // Load the most-recent N messages, then reverse so the UI still
      // renders oldest → newest. Full history paging is a follow-up.
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_type, sender_id, body, attachments, read_at, created_at")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as MessageRow[]).reverse();
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as MessageRow;
          qc.setQueryData<MessageRow[]>(["messages", conversationId], (prev) => {
            if (!prev) return [msg];
            // Avoid duplicates from optimistic insert
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev.filter((m) => !m.id.startsWith("temp-")), msg];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as MessageRow;
          qc.setQueryData<MessageRow[]>(["messages", conversationId], (prev) =>
            prev?.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) ?? [msg],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  return query;
}
