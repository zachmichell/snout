import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: "staff" | "owner";
  sender_id: string;
  body: string;
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
        .select("id, conversation_id, sender_type, sender_id, body, read_at, created_at")
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
