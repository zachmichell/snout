import { formatRelativeTime } from "@/lib/messaging";
import type { MessageRow, MessageAttachment } from "@/hooks/useMessages";

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
  const attachments = message.attachments ?? [];
  const hasBody = message.body.trim().length > 0;
  const hasAttachments = attachments.length > 0;

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
      <div className={`flex max-w-[78%] flex-col gap-1 ${isMine ? "items-end" : "items-start"}`}>
        {senderName && (
          <span className="mb-0.5 text-[11px] font-medium text-muted-foreground">{senderName}</span>
        )}

        {/* Image attachments render edge-to-edge above the text bubble */}
        {attachments
          .filter((a) => a.kind === "image")
          .map((a, i) => (
            <AttachmentImage key={`${message.id}-img-${i}`} attachment={a} isPending={isPending} />
          ))}

        {/* Document attachments render as chips above the text bubble */}
        {attachments
          .filter((a) => a.kind === "document")
          .map((a, i) => (
            <AttachmentDocument
              key={`${message.id}-doc-${i}`}
              attachment={a}
              isMine={isMine}
              isPending={isPending}
            />
          ))}

        {/* Text bubble only renders when there's body text. Attachments-only
            messages skip the empty bubble entirely. */}
        {hasBody && (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
              isMine
                ? "bg-primary text-primary-foreground"
                : "bg-card-alt text-foreground border border-border-subtle"
            } ${isPending ? "opacity-70" : ""}`}
          >
            {message.body}
          </div>
        )}

        {/* Empty-state fallback: if for some reason a message has neither
            body nor attachments (shouldn't happen, but defensive), keep the
            bubble visible so it doesn't render as nothing. */}
        {!hasBody && !hasAttachments && (
          <div
            className={`rounded-2xl px-3.5 py-2 text-sm italic ${
              isMine
                ? "bg-primary/80 text-primary-foreground/80"
                : "bg-card-alt text-muted-foreground border border-border-subtle"
            }`}
          >
            (empty message)
          </div>
        )}

        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{isPending ? "Sending…" : formatRelativeTime(message.created_at)}</span>
          {isMine && showRead && message.read_at && !isPending && <span>· Read</span>}
        </div>
      </div>
      {isMine && Avatar}
    </div>
  );
}

/** Inline image attachment — clickable, opens full-size in a new tab. */
function AttachmentImage({
  attachment,
  isPending,
}: {
  attachment: MessageAttachment;
  isPending: boolean;
}) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block max-w-full overflow-hidden rounded-2xl border border-border-subtle ${
        isPending ? "opacity-70" : ""
      }`}
    >
      <img
        src={attachment.url}
        alt={attachment.name}
        className="block max-h-72 w-auto max-w-full object-contain"
        loading="lazy"
      />
    </a>
  );
}

/** Document attachment — chip with paperclip icon, filename, and size.
 *  Opens in a new tab (PDFs render inline in modern browsers). */
function AttachmentDocument({
  attachment,
  isMine,
  isPending,
}: {
  attachment: MessageAttachment;
  isMine: boolean;
  isPending: boolean;
}) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className={`inline-flex max-w-full items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
        isMine
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
          : "bg-card-alt text-foreground border-border-subtle hover:bg-card-alt/80"
      } ${isPending ? "opacity-70" : ""}`}
    >
      {/* Paperclip icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{attachment.name}</span>
        <span
          className={`text-[10px] ${
            isMine ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}
        >
          {formatBytes(attachment.size_bytes)}
        </span>
      </div>
    </a>
  );
}

/** Human-readable file size: 12 B, 4.2 KB, 1.3 MB, 2.7 GB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
