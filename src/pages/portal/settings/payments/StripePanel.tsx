// Stripe-side of the processor selector. Identical functionality to the
// pre-3.3 PaymentsTab — the prior file's logic was extracted here so the
// new processor-picker parent can swap between Stripe and Helcim without
// duplicating either side's flows.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Clock, ExternalLink, CreditCard } from "lucide-react";
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
  useStripeConnectStatus,
  useStartStripeOnboarding,
  useDisconnectStripe,
} from "@/hooks/useStripeConnect";

export default function StripePanel() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const stripeReturn = params.get("stripe_return");
  const { data, isLoading, refetch } = useStripeConnectStatus();
  const start = useStartStripeOnboarding();
  const disconnect = useDisconnectStripe();

  useEffect(() => {
    if (stripeReturn === "success" || stripeReturn === "refresh") {
      refetch().then(() => {
        if (stripeReturn === "success") toast.success("Stripe account synced");
      });
      const next = new URLSearchParams(params);
      next.delete("stripe_return");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeReturn]);

  const handleConnect = async () => {
    try {
      const res = await start.mutateAsync();
      window.location.href = res.url;
    } catch (e: any) {
      toast.error(e.message ?? "Could not start onboarding");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      qc.invalidateQueries({ queryKey: ["stripe-connect-status"] });
      toast.success("Stripe account disconnected");
    } catch (e: any) {
      toast.error(e.message ?? "Disconnect failed");
    }
  };

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading payment settings...</div>;
  }

  const account = data?.account ?? null;

  if (!account) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-accent-light p-3">
            <CreditCard className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Connect your Stripe account
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              Accept card payments from pet owners directly into your bank account.
              Snout never holds your funds.
            </p>
            <Button
              onClick={handleConnect}
              disabled={start.isPending}
              className="mt-4 bg-accent text-white hover:bg-accent-hover"
            >
              {start.isPending ? "Redirecting..." : "Connect Stripe Account"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const stripe = data?.stripe;
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
              {stripe?.business_name ?? stripe?.email ?? "Stripe account connected"}
            </h3>
            <p className="mt-1 text-xs text-text-tertiary">
              Account ID: <code className="font-mono">{account.stripe_account_id}</code>
            </p>
            <div className="mt-3">
              <StatusBadge tone={tone} status={account.status} />
            </div>

            {account.status === "pending" && (
              <p className="mt-3 text-sm text-text-secondary">
                Your account is under review. This usually takes 1-2 business days.
                You can complete remaining onboarding steps from the Stripe dashboard.
              </p>
            )}
            {account.status === "restricted" && (
              <p className="mt-3 text-sm text-destructive">
                Stripe needs more information before payouts can be enabled.
                Open your dashboard to resolve.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <a
              href={stripe?.dashboard_url ?? "https://dashboard.stripe.com"}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" /> Manage in Stripe
              </Button>
            </a>
            {account.status !== "active" && (
              <Button onClick={handleConnect} size="sm" disabled={start.isPending}>
                {start.isPending ? "Redirecting..." : "Continue onboarding"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border-subtle pt-4">
          <Capability label="Charges" enabled={account.charges_enabled} />
          <Capability label="Payouts" enabled={account.payouts_enabled} />
          <Capability label="Details submitted" enabled={account.details_submitted} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground">Disconnect Stripe</h4>
            <p className="mt-1 text-sm text-text-secondary">
              Stop accepting new payments through Snout. Your Stripe account stays live.
              You can reconnect anytime.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Disconnect</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Stripe account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Pet owners won't be able to pay invoices online until you reconnect.
                  In-progress payments will still complete.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDisconnect}>Disconnect</AlertDialogAction>
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

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="text-sm">
      <div className="text-xs uppercase tracking-wider text-text-tertiary">{label}</div>
      <div
        className={`mt-1 font-medium ${enabled ? "text-success" : "text-text-secondary"}`}
      >
        {enabled ? "Enabled" : "Not yet"}
      </div>
    </div>
  );
}
