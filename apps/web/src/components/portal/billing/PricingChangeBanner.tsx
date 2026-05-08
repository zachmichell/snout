// Reliability Batch F: surface Snout-side pricing change notices to
// operators with a 30-day notice window. Reads
// public.pricing_change_notices for any unacknowledged-by-this-user
// row whose effective_at is in the future, renders a banner above the
// portal content, and lets the user click "Got it" to acknowledge.
//
// Acknowledgments are per-profile; once a notice is dismissed it stays
// dismissed for that user. Other staff in the same org each see and
// dismiss independently — the brief's intent is that every staff
// member sees the change at least once.
//
// Multiple active notices: we render only the most-effective-soonest
// notice at a time, so the banner doesn't stack and crowd out the
// page header. Once dismissed, the next-most-pressing notice surfaces
// automatically.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Notice = {
  id: string;
  title: string;
  body_md: string;
  effective_at: string;
  link_url: string | null;
  severity: "info" | "warning";
};

export default function PricingChangeBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notice } = useQuery({
    queryKey: ["pricing-change-banner", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Notice | null> => {
      // Pull future-effective notices the user hasn't acknowledged. Two
      // small queries: first the candidate notices, then the user's
      // acknowledgments. Filtering acks client-side is fine because the
      // notice set is tiny (at most a handful of active rows ever).
      const nowIso = new Date().toISOString();
      const { data: notices, error } = await supabase
        .from("pricing_change_notices")
        .select("id, title, body_md, effective_at, link_url, severity")
        .gte("effective_at", nowIso)
        .order("effective_at", { ascending: true })
        .limit(10);
      if (error) throw error;
      if (!notices || notices.length === 0) return null;

      const ids = notices.map((n) => n.id);
      const { data: acks } = await supabase
        .from("pricing_change_acknowledgments")
        .select("notice_id")
        .in("notice_id", ids);
      const acked = new Set((acks ?? []).map((a) => a.notice_id));
      const next = notices.find((n) => !acked.has(n.id));
      return (next ?? null) as Notice | null;
    },
  });

  const ack = useMutation({
    mutationFn: async (noticeId: string) => {
      const { error } = await supabase.rpc("acknowledge_pricing_change_notice", {
        _notice_id: noticeId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing-change-banner", user?.id] });
    },
  });

  if (!notice) return null;

  // Compute days-until for the human eye. < 0 means the notice slipped
  // past effective_at without dismissal — clamp to 0 to avoid "in -3
  // days" weirdness.
  const days = Math.max(
    0,
    Math.ceil((new Date(notice.effective_at).getTime() - Date.now()) / 86_400_000),
  );

  const tone =
    notice.severity === "warning"
      ? "border-warning/30 bg-warning-light text-foreground"
      : "border-primary/30 bg-primary-light/40 text-foreground";

  // First paragraph of the body for the inline preview. Markdown-stripped:
  // we drop the simplest formatting characters so the preview reads as
  // plain text. The full text is one click away via link_url.
  const preview = notice.body_md
    .split(/\n{2,}/)[0]
    .replace(/[*_`#]+/g, "")
    .slice(0, 220);

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-border-subtle px-6 py-3 text-sm",
        tone,
      )}
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{notice.title}</span>
          <span className="text-xs text-text-tertiary">
            Effective {format(new Date(notice.effective_at), "MMM d, yyyy")}
            {days > 0 ? ` (in ${days} day${days === 1 ? "" : "s"})` : ""}
          </span>
        </div>
        {preview && <p className="mt-0.5 truncate text-xs text-text-secondary">{preview}</p>}
        {notice.link_url && (
          <a
            href={notice.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
          >
            Read the full notice
          </a>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 self-center"
        disabled={ack.isPending}
        onClick={() => ack.mutate(notice.id)}
      >
        <X className="h-3.5 w-3.5" />
        Got it
      </Button>
    </div>
  );
}
