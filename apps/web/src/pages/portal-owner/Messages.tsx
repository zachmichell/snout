import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerConversation } from "@/hooks/useConversations";
import { useSendMessage, ensureConversation } from "@/hooks/useSendMessage";
import { useMarkConversationRead } from "@/hooks/useMarkConversationRead";
import MessageThread from "@/components/messaging/MessageThread";
import MessageComposer from "@/components/messaging/MessageComposer";

export default function OwnerMessages() {
  const { membership } = useAuth();
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const { data: conversation, refetch } = useOwnerConversation(owner?.id);
  const sendMessage = useSendMessage();
  const [creating, setCreating] = useState(false);

  const { data: org } = useQuery({
    queryKey: ["owner-org-name", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      return data;
    },
  });

  const ownerName = owner ? `${owner.first_name} ${owner.last_name}` : "You";

  useMarkConversationRead(conversation?.id, "owner");

  const handleSend = async (body: string) => {
    if (!owner || !membership?.organization_id) return;
    setCreating(true);
    try {
      const convId = conversation?.id ?? (await ensureConversation(membership.organization_id, owner.id));
      if (!conversation) await refetch();
      await sendMessage.mutateAsync({
        conversationId: convId,
        senderType: "owner",
        senderId: owner.id,
        body,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4 px-1">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Messages</h1>
        {org?.name && (
          <p className="mt-1 text-sm text-muted-foreground">Chat with {org.name}</p>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {ownerLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : !owner ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Your account is being set up. Please contact your facility.
            </p>
          </div>
        ) : conversation ? (
          <MessageThread
            conversationId={conversation.id}
            viewerSide="owner"
            viewerId={owner.id}
            ownerName={ownerName}
            emptyMessage="No messages yet — your facility will reach out here if they need anything!"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No messages yet — send the first one below to start chatting with {org?.name ?? "your facility"}.
            </p>
          </div>
        )}
        <MessageComposer
          onSend={handleSend}
          disabled={!owner || creating}
          placeholder={`Message ${org?.name ?? "your facility"}…`}
        />
      </div>
    </div>
  );
}
