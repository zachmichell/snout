// Customer-facing Helcim checkout page. Lives outside the staff portal
// because the link is shared directly with pet owners — they may not
// have an account, and they should not see staff chrome.
//
// Loads HelcimPay.js dynamically with the checkoutToken from the URL,
// renders the embedded widget, and listens for the postMessage event
// that fires on success or cancel. Final reconciliation happens on the
// helcim-webhook (3.3c) so this page does not have to be trusted to
// mark the invoice paid; it just shows confirmation.
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCentsShort } from "@/lib/money";

declare global {
  interface Window {
    appendHelcimPayIframe?: (token: string) => void;
    removeHelcimPayIframe?: () => void;
  }
}

const HELCIM_PAY_SCRIPT = "https://secure.helcim.app/helcim-pay/services/start.js";

type InvoiceShape = {
  id: string;
  invoice_number: string | null;
  total_cents: number;
  amount_paid_cents: number;
  currency: string;
  status: string;
  organization_id: string;
  helcim_checkout_expires_at: string | null;
};

export default function HelcimCheckout() {
  const { invoiceId } = useParams();
  const [params] = useSearchParams();
  const checkoutToken = params.get("ct") ?? "";

  const [invoice, setInvoice] = useState<InvoiceShape | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"pending" | "success" | "cancelled" | "error">(
    "pending",
  );
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (!invoiceId) return;
    (async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, total_cents, amount_paid_cents, currency, status, organization_id, helcim_checkout_expires_at",
        )
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) {
        setLoadError("Could not load invoice");
        return;
      }
      if (!data) {
        setLoadError("Invoice not found");
        return;
      }
      setInvoice(data);
    })();
  }, [invoiceId]);

  // Load HelcimPay.js once and trigger the iframe when both the script
  // and the checkoutToken are in hand.
  useEffect(() => {
    if (!checkoutToken || !invoice || outcome !== "pending") return;
    if (invoice.status === "paid") {
      setOutcome("success");
      return;
    }
    if (
      invoice.helcim_checkout_expires_at &&
      new Date(invoice.helcim_checkout_expires_at) < new Date()
    ) {
      setOutcome("error");
      setErrorDetail("This payment link has expired. Ask the operator to send a new one.");
      return;
    }

    const start = () => {
      if (typeof window.appendHelcimPayIframe === "function") {
        window.appendHelcimPayIframe(checkoutToken);
      } else {
        setOutcome("error");
        setErrorDetail("HelcimPay.js failed to initialize.");
      }
    };

    if (scriptLoaded.current) {
      start();
      return;
    }

    const script = document.createElement("script");
    script.src = HELCIM_PAY_SCRIPT;
    script.async = true;
    script.onload = () => {
      scriptLoaded.current = true;
      start();
    };
    script.onerror = () => {
      setOutcome("error");
      setErrorDetail("Could not load HelcimPay.js. Try a different network.");
    };
    document.body.appendChild(script);

    return () => {
      try {
        window.removeHelcimPayIframe?.();
      } catch {
        /* noop */
      }
    };
  }, [checkoutToken, invoice, outcome]);

  // HelcimPay.js posts events back to the parent window. Listen for the
  // single response and translate it into our outcome states. The
  // helcim-webhook reconciles on the server in parallel, so the user
  // sees confirmation either way.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as any;
      if (!data || typeof data !== "object") return;
      if (data.eventName !== `helcim-pay-js-${checkoutToken}`) return;

      try {
        const payload =
          typeof data.eventMessage === "string"
            ? JSON.parse(data.eventMessage)
            : data.eventMessage;
        if (data.eventStatus === "SUCCESS") {
          setOutcome("success");
        } else if (data.eventStatus === "ABORTED") {
          setOutcome("cancelled");
        } else if (data.eventStatus === "HIDE") {
          // User dismissed the modal without paying.
          setOutcome("cancelled");
        } else {
          setOutcome("error");
          setErrorDetail(payload?.message ?? "Unknown HelcimPay.js status");
        }
      } catch (e) {
        setOutcome("error");
        setErrorDetail((e as Error).message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [checkoutToken]);

  const balance = invoice
    ? Math.max((invoice.total_cents ?? 0) - (invoice.amount_paid_cents ?? 0), 0)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-6 py-12">
        <div className="rounded-lg border border-border bg-surface p-8 shadow-card">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Pay your invoice
          </h1>

          {loadError && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-light p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

          {invoice && (
            <div className="mt-4 space-y-1 text-sm text-text-secondary">
              <div>
                Invoice{" "}
                <code className="font-mono text-foreground">
                  {invoice.invoice_number ?? invoice.id.slice(0, 8)}
                </code>
              </div>
              <div>
                Amount due:{" "}
                <span className="font-semibold text-foreground">
                  {formatCentsShort(balance)} {invoice.currency}
                </span>
              </div>
            </div>
          )}

          {outcome === "pending" && invoice && (
            <p className="mt-6 text-sm text-text-secondary">
              The Helcim secure payment window will open shortly. If it does not appear,
              check that your browser has not blocked third-party iframes.
            </p>
          )}

          {outcome === "success" && (
            <div className="mt-6 flex items-start gap-2 rounded-md border border-success/30 bg-mist-bg p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div>
                <div className="font-medium text-foreground">Payment received</div>
                <div className="mt-1 text-text-secondary">
                  Thanks. The operator will see this update on their end shortly.
                </div>
              </div>
            </div>
          )}

          {outcome === "cancelled" && (
            <div className="mt-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <div className="font-medium text-foreground">Payment cancelled</div>
                <div className="mt-1 text-text-secondary">
                  No charge was made. Refresh this page to try again.
                </div>
              </div>
            </div>
          )}

          {outcome === "error" && (
            <div className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-light p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">
                  Something went wrong
                </div>
                <div className="mt-1 text-text-secondary">
                  {errorDetail ?? "Unknown error."}
                </div>
              </div>
            </div>
          )}

          {!invoice && !loadError && (
            <div className="mt-6 flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading invoice...
            </div>
          )}

          <p className="mt-8 text-xs text-text-tertiary">
            Payments are processed by Helcim. Your card details are entered into
            Helcim's secure window and never touch our servers.
            {" "}
            <Link to="/" className="underline hover:text-foreground">
              Snout
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
