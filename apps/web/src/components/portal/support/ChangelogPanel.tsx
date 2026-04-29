// Renders the changelog feed inside the support widget. Each entry is
// a card with severity badge, title, optional module chips, body
// (markdown), and a "got it" button that records the read receipt so
// the bell stops showing it as unread.
//
// The same component is rendered both inline (inside SupportWidget's
// Changelog tab) and as a popover from ChangelogBell, so the visual
// language stays consistent in both places.
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, AlertTriangle, Info, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChangelogFeed, useMarkChangelogRead, useMarkAllChangelogRead, type ChangelogSeverity } from "@/hooks/useChangelog";
import { formatDateTime } from "@/lib/money";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function ChangelogPanel({ compact = false }: { compact?: boolean }) {
  const { data: feed, isLoading } = useChangelogFeed();
  const markRead = useMarkChangelogRead();
  const markAllRead = useMarkAllChangelogRead();
  const { user } = useAuth();

  // Pull the user's read set so each entry can render its read state.
  const { data: readSet } = useQuery({
    queryKey: ["changelog-reads", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("changelog_reads")
        .select("entry_id")
        .eq("profile_id", user!.id);
      return new Set((data ?? []).map((r) => r.entry_id as string));
    },
  });

  const items = useMemo(() => feed ?? [], [feed]);

  if (isLoading) {
    return <div className="p-4 text-sm text-text-secondary">Loading...</div>;
  }
  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-text-secondary">
        No changelog entries yet. New product updates and platform notices will appear here.
      </div>
    );
  }

  return (
    <div className={compact ? "max-h-96 overflow-y-auto" : ""}>
      <div className="flex items-center justify-end px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
          className="text-xs"
        >
          <Check className="h-3 w-3" /> Mark all as read
        </Button>
      </div>
      <ul className="divide-y divide-border-subtle">
        {items.map((entry) => {
          const isRead = readSet?.has(entry.id) ?? false;
          return (
            <li key={entry.id} className={`px-4 py-3 ${isRead ? "" : "bg-accent-light/30"}`}>
              <div className="flex items-start gap-2">
                <SeverityIcon severity={entry.severity} />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-medium text-foreground">{entry.title}</h4>
                    <span className="shrink-0 text-xs text-text-tertiary">
                      {entry.published_at ? formatDateTime(entry.published_at) : ""}
                    </span>
                  </div>
                  {entry.affects_modules && entry.affects_modules.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.affects_modules.map((m) => (
                        <span
                          key={m}
                          className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 prose prose-sm max-w-none text-sm text-text-secondary">
                    <ReactMarkdown>{entry.body_md}</ReactMarkdown>
                  </div>
                  {!isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(entry.id)}
                      className="mt-2 h-7 text-xs"
                    >
                      <Check className="h-3 w-3" /> Got it
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: ChangelogSeverity }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  switch (severity) {
    case "critical":
      return <AlertTriangle className={`${cls} text-destructive`} />;
    case "warning":
      return <AlertTriangle className={`${cls} text-warning`} />;
    case "update":
      return <Sparkles className={`${cls} text-accent`} />;
    default:
      return <Info className={`${cls} text-text-secondary`} />;
  }
}

// Re-export the success icon for callers that want a "no unread" affordance.
export const ReadIcon = CheckCircle2;
