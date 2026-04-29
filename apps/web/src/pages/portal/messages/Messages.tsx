import { useState, useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { useStaffConversations, type ConversationRow } from "@/hooks/useConversations";
import { useSendMessage } from "@/hooks/useSendMessage";
import { useMarkConversationRead } from "@/hooks/useMarkConversationRead";
import { useAuth } from "@/hooks/useAuth";
import { formatRelativeTime, petListLabel, truncatePreview } from "@/lib/messaging";
import MessageThread from "@/components/messaging/MessageThread";
import MessageComposer from "@/components/messaging/MessageComposer";
import PortalLayout from "@/components/portal/PortalLayout";

export default function StaffMessages() {
  const { user } = useAuth();
  const { data: conversations, isLoading } = useStaffConversations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sendMessage = useSendMessage();

  // Auto-select first conversation
  const firstId = conversations?.[0]?.id;
  const selectedId = activeId ?? firstId ?? null;
  const active = useMemo<ConversationRow | undefined>(
    () => conversations?.find((c) => c.id === selectedId),
    [conversations, selectedId],
  );

  useMarkConversationRead(selectedId ?? undefined, "staff");

  const ownerName = active?.owner ? `${active.owner.first_name} ${active.owner.last_name}` : "";

  const handleSend = async (body: string) => {
    if (!active || !user) return;
    await sendMessage.mutateAsync({
      conversationId: active.id,
      senderType: "staff",
      senderId: user.id,
      body,
    });
  };

  return (
    <PortalLayout>
    <div className="flex h-[calc(100vh-4rem)] flex-col p-6">
      <div className="mb-4">
        <h1 className="font-display text-2xl font-bold text-foreground">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Direct conversations with pet owners
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Conversation list */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No conversations yet — messages with pet owners will appear here
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {conversations.map((c) => {
                  const owner = c.owner;
                  const name = owner ? `${owner.first_name} ${owner.last_name}` : "Owner";
                  const petNames =
                    owner?.pet_owners?.map((po) => po.pets?.name).filter(Boolean) as string[] | undefined;
                  const isActive = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(c.id)}
                        className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                          isActive ? "bg-primary-light" : "hover:bg-card-alt"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                          {c.unread_staff > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                              {c.unread_staff}
                            </span>
                          )}
                        </div>
                        {petNames && petNames.length > 0 && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {petListLabel(petNames)}
                          </div>
                        )}
                        {c.last_message_preview && (
                          <div className="truncate text-xs text-foreground/70">
                            {truncatePreview(c.last_message_preview, 50)}
                          </div>
                        )}
                        {c.last_message_at && (
                          <div className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(c.last_message_at)}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Active thread */}
        <div className="flex flex-1 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="text-sm text-muted-foreground">Select a conversation to view messages</p>
            </div>
          ) : (
            <>
              <header className="border-b border-border px-5 py-3">
                <h2 className="font-display text-base font-semibold text-foreground">{ownerName}</h2>
              </header>
              <MessageThread
                conversationId={active.id}
                viewerSide="staff"
                viewerId={user?.id}
                ownerName={ownerName}
              />
              <MessageComposer onSend={handleSend} placeholder="Message this owner…" />
            </>
          )}
        </div>
      </div>
    </div>
    </PortalLayout>
  );
}
