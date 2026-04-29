import { Link } from "react-router-dom";
import { FileText, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { WaiverWithStatus } from "@/hooks/useOwnerWaivers";

export default function WaiverCard({ waiver }: { waiver: WaiverWithStatus }) {
  const { status } = waiver;

  const badge =
    status === "signed" ? (
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-mist/40 bg-mist-bg px-2.5 py-0.5 text-[11px] font-semibold text-success">
        <CheckCircle2 className="h-3 w-3" /> Signed
      </span>
    ) : status === "outdated" ? (
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-vanilla/40 bg-vanilla-bg px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
        <AlertTriangle className="h-3 w-3" /> Updated — Re-signature required
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-pill border border-destructive/30 bg-destructive-light px-2.5 py-0.5 text-[11px] font-semibold text-destructive">
        <XCircle className="h-3 w-3" /> Not signed
      </span>
    );

  const ctaLabel = status === "signed" ? "View" : "View & Sign";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-semibold text-foreground">{waiver.title}</h3>
            {badge}
          </div>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Version {waiver.version}
          </p>
          {waiver.signed_at && (
            <p className="mt-1 text-sm text-muted-foreground">
              {status === "outdated" ? (
                <>
                  Last signed {formatDate(waiver.signed_at)} (version {waiver.signed_version})
                </>
              ) : (
                <>
                  Signed on {formatDate(waiver.signed_at)} (version {waiver.signed_version})
                </>
              )}
            </p>
          )}
        </div>
        <Button asChild variant={status === "signed" ? "outline" : "default"}>
          <Link to={`/portal/waivers/${waiver.id}`}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
