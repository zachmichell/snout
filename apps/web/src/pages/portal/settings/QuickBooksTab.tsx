// QuickBooks Online connection management. Two states:
//   * No live account: hero card explaining what the integration does
//     and a "Connect QuickBooks" button that starts the OAuth flow.
//   * Connected: status card with company name, environment badge,
//     last-verified timestamp, "Verify now" button, and a disconnect
//     dialog that revokes at Intuit and soft-deletes locally.
//
// 6.1 scope: connection only. Sync and reconciliation land in 6.2-6.6.
// The card includes a "what's next" footnote so operators understand
// they aren't done after connecting.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  RefreshCw,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useQuickBooksStatus,
  useStartQuickBooksOnboarding,
  useDetachQuickBooks,
  useQuickBooksLiveCheck,
} from "@/hooks/useQuickBooks";
import { formatDateTime } from "@/lib/money";

export default function QuickBooksTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const qboReturn = params.get("qbo_return");
  const qboReason = params.get("reason");

  const { data, isLoading } = useQuickBooksStatus();
  const start = useStartQuickBooksOnboarding();
  const liveCheck = useQuickBooksLiveCheck();
  const detach = useDetachQuickBooks();

  // After returning from Intuit, surface the result and clean up the
  // URL so a refresh doesn't re-toast.
  useEffect(() => {
    if (qboReturn === "success") {
      toast.success("QuickBooks connected");
      qc.invalidateQueries({ queryKey: ["quickbooks-status"] });
    } else if (qboReturn === "error") {
      toast.error(qboReason ? `QuickBooks connect failed: ${qboReason}` : "QuickBooks connect failed");
    }
    if (qboReturn) {
      const next = new URLSearchParams(params);
      next.delete("qbo_return");
      next.delete("reason");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qboReturn, qboReason]);

  const handleConnect = async () => {
    try {
      const res = await start.mutateAsync(window.location.pathname + window.location.search);
      window.location.href = res.url;
    } catch (e: any) {
      const message = e?.context?.error ?? e?.message ?? "Could not start QuickBooks connect";
      toast.error(message);
    }
  };

  const handleLiveCheck = async () => {
    try {
      const res = await liveCheck.mutateAsync();
      if (res.live_check?.ok) {
        toast.success("QuickBooks token verified");
      } else {
        const reason = res.live_check?.error ?? res.live_check?.reason ?? "Unknown error";
        toast.error(`Verification failed: ${reason}`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Verification failed");
    }
  };

  const handleDetach = async () => {
    try {
      const res = await detach.mutateAsync();
      if (res.revoke_error) {
        toast.warning(
          "QuickBooks disconnected locally, but Intuit revoke failed. Disconnect manually in QBO if needed.",
        );
      } else {
        toast.success("QuickBooks disconnected");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Disconnect failed");
    }
  };

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading QuickBooks settings...</div>;
  }

  const account = data?.account ?? null;

  if (!account) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-accent-light p-3">
            <Receipt className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Connect QuickBooks Online
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              Push your Snout invoices, payments, and refunds to QuickBooks
              automatically. We send to QuickBooks; QuickBooks remains the book of
              record for accounting. The integration is one-way only: edits in
              QuickBooks do not flow back.
            </p>
            <p className="mt-2 text-xs text-text-tertiary">
              You'll be redirected to Intuit to grant access. Snout never sees your
              QuickBooks password.
            </p>
            <Button
              onClick={handleConnect}
              disabled={start.isPending}
              className="mt-4 bg-accent text-white hover:bg-accent-hover"
            >
              {start.isPending ? "Redirecting..." : "Connect QuickBooks"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const tone =
    account.status === "active"
      ? "success"
      : account.status === "restricted"
        ? "danger"
        : "warning";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-foreground">
              {account.company_name ?? "QuickBooks account connected"}
            </h3>
            <p className="mt-1 text-xs text-text-tertiary">
              Realm ID: <code className="font-mono">{account.realm_id}</code>
              {" · "}
              <span className="uppercase">{account.environment}</span>
              {account.last_verified_at && (
                <>
                  {" · "}Last verified {formatDateTime(account.last_verified_at)}
                </>
              )}
            </p>
            <div className="mt-3">
              <StatusBadge tone={tone} status={account.status} />
            </div>

            {account.status === "restricted" && account.last_verification_error && (
              <p className="mt-3 text-sm text-destructive">
                Intuit returned: {account.last_verification_error}. Try Verify now,
                or disconnect and reconnect to refresh authorization.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <a
              href={
                account.environment === "sandbox"
                  ? "https://app.sandbox.qbo.intuit.com/app/homepage"
                  : "https://qbo.intuit.com/"
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" /> Open QuickBooks
              </Button>
            </a>
            <Button
              onClick={handleLiveCheck}
              size="sm"
              variant="outline"
              disabled={liveCheck.isPending}
            >
              <RefreshCw className="h-4 w-4" />
              {liveCheck.isPending ? "Checking..." : "Verify now"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <h4 className="font-medium text-foreground">What syncs to QuickBooks</h4>
        <ul className="mt-2 space-y-1 text-sm text-text-secondary">
          <li>Customers (Snout owners) and items (services, products)</li>
          <li>Invoices, with tax overridden to match Snout's authoritative number</li>
          <li>Payments and refunds</li>
          <li>Processor fees and tips, reconciled daily as journal entries</li>
        </ul>
        <p className="mt-3 text-xs text-text-tertiary">
          Sync configuration and history are coming in subsequent batches. The
          connection itself works as soon as the status above shows Active.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground">Disconnect QuickBooks</h4>
            <p className="mt-1 text-sm text-text-secondary">
              Stops pushing new invoices and payments to QuickBooks. Existing
              QuickBooks records stay; Snout simply forgets the authorization.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Disconnect</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
                <AlertDialogDescription>
                  Future invoices and payments will not push to QuickBooks until
                  you reconnect. Records already in QuickBooks are unaffected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDetach}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ tone, status }: { tone: "success" | "warning" | "danger"; status: string }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? AlertTriangle : Clock;
  const cls =
    tone === "success"
      ? "bg-mist-bg text-success border-mist/40"
      : tone === "danger"
        ? "bg-destructive-light text-destructive border-destructive/30"
        : "bg-vanilla-bg text-warning border-vanilla/40";
  const label =
    status === "active" ? "Active" : status === "restricted" ? "Restricted" : "Pending";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
