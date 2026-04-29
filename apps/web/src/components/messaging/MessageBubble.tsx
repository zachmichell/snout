import { formatRelativeTime } from "@/lib/messaging";
import type { MessageRow } from "@/hooks/useMessages";

type Props = {
  message: MessageRow;
  isMine: boolean;
  senderName?: string;
  senderInitials?: string;
  avatarUrl?: string | null;
  showRead?: boolean;
};

export default function MessageBubble({
  message,
  isMine,
  senderName,
  senderInitials,
  avatarUrl,
  showRead,
}: Props) {
  const isPending = message.id.startsWith("temp-");

  const Avatar = (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
      {avatarUrl ? (
        <img src={avatarUrl} alt={senderName ?? ""} className="h-full w-full object-cover" />
      ) : (
        (senderInitials ?? "?").slice(0, 2)
      )}
    </div>
  );

  return (
    <div className={`flex w-full gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
      {!isMine && Avatar}
      <div className={`flex max-w-[78%] flex-col ${isMine ? "items-end" : "items-start"}`}>
        {senderName && (
          <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">{senderName}</span>
        )}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isMine
              ? "bg-primary text-primary-foreground"
              : "bg-card-alt text-foreground border border-border-subtle"
          } ${isPending ? "opacity-70" : ""}`}
        >
          {message.body}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{isPending ? "Sending…" : formatRelativeTime(message.created_at)}</span>
          {isMine && showRead && message.read_at && !isPending && <span>· Read</span>}
        </div>
      </div>
      {isMine && Avatar}
    </div>
  );
}
