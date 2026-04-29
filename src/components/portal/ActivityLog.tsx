import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Status changes (created, confirmed, checked in/out, cancelled, no-show) are
 * surfaced on the Status timeline; the Activity log focuses on everything else
 * (edits, comments, payments, refunds, add-ons attached, etc.) so the two
 * sections don't duplicate each other.
 */
const STATUS_CHANGE_ACTIONS = new Set<string>([
  "created",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
]);

/**
 * Activity log for a single entity (reservation, service, etc).
 * Renders newest-first. Each entry shows action + actor + relative time.
 *
 * Actor source: pulled from `metadata.actor_label` written by `logActivity`.
 * Falls back to "Staff" if missing (older rows pre-actor tracking).
 */
export function ActivityLog({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string | undefined;
}) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["activity-log", entityType, entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, actor_id, metadata, created_at")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((e) => !STATUS_CHANGE_ACTIONS.has(e.action));
    },
  });

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading activity…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No activity yet. Edits, comments, and other changes will appear here.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <ActivityItem key={e.id} entry={e} />
      ))}
    </ol>
  );
}

function ActivityItem({ entry }: { entry: any }) {
  const { icon: Icon, tone } = iconFor(entry.action);
  const message = messageFor(entry.action, entry.metadata);
  const actor = actorLabel(entry.metadata);
  const when = format(new Date(entry.created_at), "MMM d, yyyy · h:mm a");

  return (
    <li className="flex items-start gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          tone,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground">{message}</div>
        <div className="text-xs text-text-tertiary">
          {actor} · {when}
        </div>
      </div>
    </li>
  );
}

function actorLabel(metadata: any): string {
  const label = metadata?.actor_label;
  if (label) return `by ${label}`;
  // Older rows logged before the actor convention — fall back gracefully.
  return "by Staff";
}

function messageFor(action: string, metadata: any): string {
  switch (action) {
    case "created":
      return "Reservation created";
    case "confirmed":
      return "Confirmed";
    case "cancelled":
      return metadata?.reason ? `Cancelled: ${metadata.reason}` : "Cancelled";
    case "deleted":
      return "Deleted";
    case "checked_in":
      return "Checked in";
    case "checked_out":
      return "Checked out";
    case "no_show":
      return "Marked no-show";
    case "updated":
      return metadata?.summary ? `Edited: ${metadata.summary}` : "Edited";
    case "commented":
      return metadata?.comment ? `Comment: ${metadata.comment}` : "Comment added";
    case "paid":
      return "Invoice paid";
    case "refunded":
      return "Refunded";
    default:
      return prettyAction(action);
  }
}

function prettyAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconFor(action: string): { icon: typeof ClipboardList; tone: string } {
  const success = "bg-success-bg text-success";
  const teal = "bg-brand-frost-bg text-teal";
  const warn = "bg-warning-bg text-warning";
  const danger = "bg-destructive/10 text-destructive";
  const muted = "bg-muted text-muted-foreground";

  switch (action) {
    case "created":
      return { icon: Plus, tone: muted };
    case "confirmed":
      return { icon: CheckCircle2, tone: success };
    case "cancelled":
    case "deleted":
      return { icon: XCircle, tone: danger };
    case "checked_in":
      return { icon: LogIn, tone: success };
    case "checked_out":
      return { icon: LogOut, tone: teal };
    case "no_show":
      return { icon: AlertTriangle, tone: warn };
    case "updated":
      return { icon: Pencil, tone: muted };
    case "commented":
      return { icon: MessageSquare, tone: muted };
    case "paid":
    case "refunded":
      return { icon: Receipt, tone: success };
    default:
      return { icon: ClipboardList, tone: muted };
  }
}
