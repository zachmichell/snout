import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Inbox, Syringe, Image as ImageIcon, FileSignature, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * Surfaces customer uploads from the last seven days so staff can verify
 * vaccinations, agreements, and pet photos that owners submit through their
 * portal. Replaces the silent-failure behavior that drove operators off
 * Gingr (uploads succeeded for the customer but never reached the staff
 * dashboard).
 *
 * Reads from activity_log with actor_kind = 'owner' over a rolling 7-day
 * window. Hidden when there are no recent uploads, so the card does not
 * compete for attention on a quiet day.
 */
const UPLOAD_ACTIONS = ["uploaded", "photo_uploaded", "signed"];
const WINDOW_DAYS = 7;
const PREVIEW_LIMIT = 5;

type UploadRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: any;
  created_at: string;
};

export function RecentCustomerUploads() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: rows = [] } = useQuery({
    queryKey: ["recent-customer-uploads", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, entity_type, entity_id, metadata, created_at")
        .eq("organization_id", orgId!)
        .in("action", UPLOAD_ACTIONS)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).filter(
        (r) => (r.metadata as { actor_kind?: string } | null)?.actor_kind === "owner",
      ) as UploadRow[];
    },
  });

  if (!orgId || rows.length === 0) return null;

  const preview = rows.slice(0, PREVIEW_LIMIT);
  const overflow = Math.max(0, rows.length - preview.length);

  return (
    <div className="mb-5 rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-text-secondary" />
          <span className="font-display text-base text-foreground">
            Recent customer uploads
          </span>
          <span className="text-xs text-text-tertiary">
            {rows.length} in the last {WINDOW_DAYS} days
          </span>
        </div>
        <Link
          to="/settings/audit-log"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <ul className="space-y-2">
        {preview.map((r) => (
          <UploadItem key={r.id} row={r} />
        ))}
      </ul>
      {overflow > 0 && (
        <div className="mt-2 text-xs text-text-tertiary">
          Plus {overflow} more in the audit log.
        </div>
      )}
    </div>
  );
}

function UploadItem({ row }: { row: UploadRow }) {
  const { icon: Icon, link } = displayFor(row);
  const summary =
    (row.metadata as { summary?: string } | null)?.summary ?? prettify(row.action, row.entity_type);
  const when = format(new Date(row.created_at), "MMM d, h:mm a");

  const inner = (
    <div className="flex items-center gap-3">
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{summary}</div>
        <div className="text-xs text-text-tertiary">by Owner · {when}</div>
      </div>
    </div>
  );

  if (link) {
    return (
      <li>
        <Link to={link} className="block rounded-md p-1 hover:bg-background/60">
          {inner}
        </Link>
      </li>
    );
  }
  return <li className="p-1">{inner}</li>;
}

function displayFor(row: UploadRow): { icon: typeof Inbox; link: string | null } {
  switch (row.entity_type) {
    case "vaccination": {
      const petId = (row.metadata as { pet_id?: string } | null)?.pet_id;
      return { icon: Syringe, link: petId ? `/pets/${petId}` : null };
    }
    case "pet":
      return { icon: ImageIcon, link: row.entity_id ? `/pets/${row.entity_id}` : null };
    case "agreement": {
      const ownerId = (row.metadata as { owner_id?: string } | null)?.owner_id;
      return { icon: FileSignature, link: ownerId ? `/owners/${ownerId}` : null };
    }
    case "waiver_signature": {
      const ownerId = (row.metadata as { owner_id?: string } | null)?.owner_id;
      return { icon: FileSignature, link: ownerId ? `/owners/${ownerId}` : null };
    }
    default:
      return { icon: Inbox, link: null };
  }
}

function prettify(action: string, entityType: string): string {
  const a = action.replace(/_/g, " ");
  return `${a.charAt(0).toUpperCase() + a.slice(1)} on ${entityType.replace(/_/g, " ")}`;
}
