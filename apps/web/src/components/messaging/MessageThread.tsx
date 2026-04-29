import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMessages } from "@/hooks/useMessages";
import MessageBubble from "./MessageBubble";

type Props = {
  conversationId: string;
  /** Which side am I on? Determines which bubbles are "mine" */
  viewerSide: "staff" | "owner";
  /** Owner display info (for labelling owner messages on staff side) */
  ownerName?: string;
  /** My own user/owner id used to compare to message.sender_id when viewerSide matches */
  viewerId?: string;
  emptyMessage?: string;
};

export default function MessageThread({
  conversationId,
  viewerSide,
  ownerName,
  viewerId,
  emptyMessage,
}: Props) {
  const { data: messages, isLoading } = useMessages(conversationId);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Collect unique staff sender ids to fetch their profile info (name + avatar)
  const staffIds = useMemo(() => {
    const set = new Set<string>();
    (messages ?? []).forEach((m) => {
      if (m.sender_type === "staff") set.add(m.sender_id);
    });
    return Array.from(set);
  }, [messages]);

  const { data: staffProfiles } = useQuery({
    queryKey: ["message-staff-profiles", staffIds.sort().join(",")],
    enabled: staffIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", staffIds);
      const map: Record<string, { first_name: string | null; last_name: string | null; avatar_url: string | null }> = {};
      (data ?? []).forEach((p) => {
        map[p.id] = { first_name: p.first_name, last_name: p.last_name, avatar_url: p.avatar_url };
      });
      return map;
    },
  });

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (isLoading) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">Loading messages…</div>;
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "Start the conversation by sending a message below"}
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages.map((m) => {
        const isMine =
          (viewerSide === "staff" && m.sender_type === "staff" && (!viewerId || m.sender_id === viewerId)) ||
          (viewerSide === "owner" && m.sender_type === "owner");

        let senderName: string | undefined;
        let senderInitials: string | undefined;
        let avatarUrl: string | null | undefined;

        if (m.sender_type === "staff") {
          const p = staffProfiles?.[m.sender_id];
          const first = p?.first_name ?? "";
          const last = p?.last_name ?? "";
          senderName = [first, last].filter(Boolean).join(" ") || "Staff";
          senderInitials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "S";
          avatarUrl = p?.avatar_url ?? null;
        } else {
          senderName = ownerName ?? "Owner";
          senderInitials = (ownerName ?? "O")
            .split(" ")
            .map((s) => s[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase();
          avatarUrl = null;
        }

        return (
          <MessageBubble
            key={m.id}
            message={m}
            isMine={isMine}
            senderName={isMine ? undefined : senderName}
            senderInitials={senderInitials}
            avatarUrl={avatarUrl}
            showRead={isMine}
          />
        );
      })}
    </div>
  );
}
