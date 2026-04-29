import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MessageRow } from "./useMessages";

type SendArgs = {
  conversationId: string;
  senderType: "staff" | "owner";
  senderId: string;
  body: string;
};

/** Send a message with optimistic UI update */
export function useSendMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, senderType, senderId, body }: SendArgs) => {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_type: senderType,
          sender_id: senderId,
          body,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as MessageRow;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["messages", vars.conversationId] });
      const prev = qc.getQueryData<MessageRow[]>(["messages", vars.conversationId]);
      const optimistic: MessageRow = {
        id: `temp-${Date.now()}`,
        conversation_id: vars.conversationId,
        sender_type: vars.senderType,
        sender_id: vars.senderId,
        body: vars.body,
        read_at: null,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<MessageRow[]>(["messages", vars.conversationId], [...(prev ?? []), optimistic]);
      return { prev, tempId: optimistic.id };
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["messages", vars.conversationId], ctx?.prev);
      toast.error("Couldn't send message");
    },
    onSuccess: (msg, vars, ctx) => {
      qc.setQueryData<MessageRow[]>(["messages", vars.conversationId], (prev) => {
        if (!prev) return [msg];
        return prev.map((m) => (m.id === ctx?.tempId ? msg : m));
      });
    },
  });
}

/** Lazy-create the owner ↔ org conversation if it doesn't exist yet, then return its id */
export async function ensureConversation(orgId: string, ownerId: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ organization_id: orgId, owner_id: ownerId })
    .select("id")
    .single();
  if (error) {
    // Race: another insert created it
    const { data: again } = await supabase
      .from("conversations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}
