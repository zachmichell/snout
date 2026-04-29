// Helcim attachment panel. Two states:
// 1. No live account: a token-paste form. Submit verifies the token by
//    hitting Helcim's /connect-test through our edge function. On success
//    the org is flipped to processor='helcim' atomically.
// 2. Live account present: a status card mirroring the Stripe panel's
//    look (status badge, capabilities, disconnect). A "Verify now" button
//    triggers a live re-ping so operators can confirm the token still
//    works after they revoked or rotated it on Helcim's side.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Clock, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  useHelcimStatus,
  useAttachHelcim,
  useDetachHelcim,
  useHelcimLiveCheck,
} from "@/hooks/useHelcim";
import { formatDateTime } from "@/lib/money";

export default function HelcimPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useHelcimStatus();
  const attach = useAttachHelcim();
  const detach = useDetachHelcim();
  const liveCheck = useHelcimLiveCheck();

  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [currency, setCurrency] = useState<"CAD" | "USD">("CAD");
  const [verifier, setVerifier] = useState("");

  const handleAttach = async () => {
    try {
      await attach.mutateAsync({
        api_token: token.trim(),
        account_label: label.trim() || undefined,
        currency,
        webhook_verifier: verifier.trim() || undefined,
      });
      toast.success("Helcim connected");
      setToken("");
      setLabel("");
      setVerifier("");
      qc.invalidateQueries({ queryKey: ["helcim-status"] });
    } catch (e: any) {
      const msg = e?.context?.error ?? e?.message ?? "Could not verify Helcim token";
      toast.error(msg);
    }
  };

  const handleDetach = async () => {
    try {
      await detach.mutateAsync();
      toast.success("Helcim disconnected");
    } catch (e: any) {
      toast.error(e?.message ?? "Disconnect failed");
    }
  };

  const handleLiveCheck = async () => {
    try {
      const res = await liveCheck.mutateAsync();
      toast.success(
        res.account?.charges_enabled
          ? "Helcim token verified"
          : "Helcim rejected the stored token",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Verification failed");
    }
  };

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading Helcim settings...</div>;
  }

  const account = data?.account ?? null;

  if (!account) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-accent-light p-3">
            <KeyRound className="h-6 w-6 text-accent" />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-foreground">
                Connect your Helcim account
              </h3>
              <p className="mt-1 text-sm text-text-secondary">
                Paste an API token from your Helcim dashboard. Funds settle directly to
                your Helcim merchant account; Snout never holds them. The token is
                encrypted at rest in our vault and is never visible to your team.
              </p>
              <p className="mt-2 text-xs text-text-tertiary">
                In Helcim, go to Settings &rarr; Integrations &rarr; API Access and
                generate a token with payments and webhooks scopes.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-xs">API token</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="aTk_..."
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Account label (optional)</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Main location"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as "CAD" | "USD")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAD">CAD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Webhook verifier token (optional)</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={verifier}
                  onChange={(e) => setVerifier(e.target.value)}
                  placeholder="From Helcim &rarr; Webhooks &rarr; Verifier"
                  className="mt-1 font-mono"
                />
                <p className="mt-1 text-xs text-text-tertiary">
                  Required for paid invoices to auto-mark as paid. Without it, payments
                  succeed but you will need to reconcile manually until you paste the
                  verifier and configure the webhook URL inside Helcim.
                </p>
              </div>
            </div>

            <Button
              onClick={handleAttach}
              disabled={attach.isPending || token.trim().length < 8}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              {attach.isPending ? "Verifying..." : "Verify and connect"}
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
              {account.business_name ?? "Helcim account connected"}
            </h3>
            <p className="mt-1 text-xs text-text-tertiary">
              Currency: <code className="font-mono">{account.currency}</code>
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
                Helcim returned: {account.last_verification_error}. Generate a new token
                in Helcim and rotate it here.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <a
              href="https://hub.helcim.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" /> Manage in Helcim
              </Button>
            </a>
            <Button
              onClick={handleLiveCheck}
              size="sm"
              disabled={liveCheck.isPending}
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" />
              {liveCheck.isPending ? "Checking..." : "Verify now"}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border-subtle pt-4">
          <Capability label="Charges" enabled={account.charges_enabled} />
          <Capability label="Token verified" enabled={!!account.last_verified_at} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground">Disconnect Helcim</h4>
            <p className="mt-1 text-sm text-text-secondary">
              Removes the API token from our vault and falls back to Stripe so your
              checkout flows keep working. Your Helcim merchant account is unaffected.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Disconnect</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Helcim?</AlertDialogTitle>
                <AlertDialogDescription>
                  New invoices will use Stripe until you reconnect a Helcim account.
                  In-progress Helcim checkouts will still complete.
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
