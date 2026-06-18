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
import {
  useQuickBooksMappingCounts,
  useSyncQuickBooksCustomers,
  useSyncQuickBooksItems,
  useSyncAllQuickBooksCustomers,
  useSyncAllQuickBooksItems,
  useQuickBooksFailedMappings,
  useRetryFailedMapping,
  useResetFailedMappings,
  useQuickBooksSyncQueueStatus,
  useEnqueueInvoiceBackfill,
  useEnqueuePaymentBackfill,
  useQuickBooksTaxCodes,
  useRefreshQuickBooksTaxCodes,
  useDownloadQuickBooksMappingReport,
  useQuickBooksFeeAccounts,
  useQuickBooksAccountSettings,
  useSetQuickBooksFeeAccount,
  useSyncQuickBooksPayouts,
  useIngestStripePayouts,
  useQuickBooksLiabilityAccounts,
  useSetQuickBooksTipsPayableAccount,
  useSyncQuickBooksTips,
  useQuickBooksIncomeAccounts,
  useSetQuickBooksCreditAccount,
  useSyncQuickBooksCreditLedger,
  type CreditAccountSlot,
  type SyncResult,
  type SyncCounts,
  type SyncAllProgress,
  type FailedMapping,
  type QuickBooksTaxCode,
} from "@/hooks/useQuickBooksSync";
import {
  Select as Sel,
  SelectContent as SelContent,
  SelectItem as SelItem,
  SelectTrigger as SelTrigger,
  SelectValue as SelValue,
} from "@/components/ui/select";
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

      <SyncPanel />

      <AutoSyncPanel />

      <FailedSyncsPanel />

      <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
        <h4 className="font-medium text-foreground">What syncs to QuickBooks</h4>
        <ul className="mt-2 space-y-1 text-sm text-text-secondary">
          <li>Customers (Snout owners) and items (services). 6.2 ships these.</li>
          <li>Invoices, with tax overridden to match Snout's authoritative number. 6.3.</li>
          <li>Payments and refunds. 6.4.</li>
          <li>Processor fees and tips, reconciled daily as journal entries. 6.6.</li>
        </ul>
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

// Sync panel: per-entity-type cards showing total/synced/pending/failed
// counts, a "Sync now" (single batch) and "Sync all" (loops until done)
// button per type, plus a live progress strip while a sync-all is
// running.
function SyncPanel() {
  const counts = useQuickBooksMappingCounts();
  const syncCustomers = useSyncQuickBooksCustomers();
  const syncItems = useSyncQuickBooksItems();
  const allCustomers = useSyncAllQuickBooksCustomers();
  const allItems = useSyncAllQuickBooksItems();
  const enqueueInvoices = useEnqueueInvoiceBackfill();
  const enqueuePayments = useEnqueuePaymentBackfill();

  const ownerCounts = counts.data?.find((c) => c.table === "owners");
  const serviceCounts = counts.data?.find((c) => c.table === "services");
  const invoiceCounts = counts.data?.find((c) => c.table === "invoices");
  const paymentCounts = counts.data?.find((c) => c.table === "payments");

  const handleSyncOne = async (
    label: string,
    mut: { mutateAsync: () => Promise<SyncResult>; isPending: boolean },
  ) => {
    try {
      const res = await mut.mutateAsync();
      if (res.failed > 0) {
        toast.warning(
          `${label} sync finished with ${res.failed} failure${res.failed === 1 ? "" : "s"}. See the Failed Syncs panel below for details and a retry option.`,
        );
      } else if (res.has_more) {
        toast.success(
          `${label} batch complete: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged. More remaining; click Sync all to finish.`,
        );
      } else {
        toast.success(
          `${label} sync complete: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged.`,
        );
      }
    } catch (e: any) {
      const message = e?.context?.error ?? e?.message ?? "Sync failed";
      toast.error(message);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
      <h4 className="font-medium text-foreground">Sync to QuickBooks</h4>
      <p className="mt-1 text-xs text-text-secondary">
        Push the current Snout entities to QuickBooks. Re-running is safe; only
        new or changed rows are sent. Each sync batch processes up to 100 rows;
        Sync all loops batches until everything is in QBO.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <SyncCard
          title="Customers"
          subtitle="From Snout owners"
          counts={ownerCounts}
          loading={counts.isLoading}
          syncing={syncCustomers.isPending}
          progress={allCustomers.progress}
          onSync={() => handleSyncOne("Customer", syncCustomers)}
          onSyncAll={() => allCustomers.start()}
          onCancel={() => allCustomers.cancel()}
        />
        <SyncCard
          title="Items"
          subtitle="From Snout services. First sync auto-picks an Income account in QBO."
          counts={serviceCounts}
          loading={counts.isLoading}
          syncing={syncItems.isPending}
          progress={allItems.progress}
          onSync={() => handleSyncOne("Item", syncItems)}
          onSyncAll={() => allItems.start()}
          onCancel={() => allItems.cancel()}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <InvoiceSyncCard
          counts={invoiceCounts}
          loading={counts.isLoading}
          isPending={enqueueInvoices.isPending}
          onSyncAll={async () => {
            try {
              const n = await enqueueInvoices.mutateAsync(1000);
              if (n === 0) {
                toast.success("All invoices already up to date");
              } else {
                toast.success(`${n} invoice${n === 1 ? "" : "s"} queued. Auto-sync worker drains them at ~50/minute; watch the activity panel below.`);
              }
            } catch (e: any) {
              toast.error(e?.message ?? "Could not enqueue invoices");
            }
          }}
        />
        <PaymentSyncCard
          counts={paymentCounts}
          loading={counts.isLoading}
          isPending={enqueuePayments.isPending}
          onSyncAll={async () => {
            try {
              const n = await enqueuePayments.mutateAsync(1000);
              if (n === 0) {
                toast.success("All payments already up to date");
              } else {
                toast.success(`${n} payment${n === 1 ? "" : "s"} queued. Auto-sync worker drains them at ~50/minute; watch the activity panel below.`);
              }
            } catch (e: any) {
              toast.error(e?.message ?? "Could not enqueue payments");
            }
          }}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <TaxCodesCard />
        <ReconciliationCard />
      </div>

      <div className="mt-3">
        <PayoutsCard />
      </div>

      <div className="mt-3">
        <TipsCard />
      </div>

      <div className="mt-3">
        <CreditAccountsCard />
      </div>

      <div className="mt-3">
        <CustomerDepositsCard />
      </div>
    </div>
  );
}

// 6.6b: Tips. Liability account picker + on-demand sync. Iterates
// Snout reservations + grooming_appointments with tip_cents > 0 and
// posts a Journal Entry per record:
//   Debit  Undeposited Funds  (tip)
//   Credit Tips Payable       (tip)
function TipsCard() {
  const { data: settings } = useQuickBooksAccountSettings();
  const { data: liabilityAccounts = [], isLoading: liabLoading } =
    useQuickBooksLiabilityAccounts();
  const setTips = useSetQuickBooksTipsPayableAccount();
  const syncTips = useSyncQuickBooksTips();

  const currentTipsId = settings?.default_tips_payable_account_id ?? "";
  const currentTipsName = settings?.default_tips_payable_account_name ?? null;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-3">
        <div className="font-medium text-foreground">Tips</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          Tips your staff collected from customers (cash or via the Stripe
          terminal) post to a QBO Liability account so the operator can
          distribute them to staff later. One Journal Entry per tipped
          record: debit Undeposited Funds, credit Tips Payable.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
            Tips Payable account
          </label>
          <Sel
            value={currentTipsId || "__none__"}
            onValueChange={(v) => {
              if (v === "__none__") return;
              const acct = liabilityAccounts.find((a) => a.id === v);
              if (!acct) return;
              setTips.mutate(
                { id: acct.id, name: acct.name },
                {
                  onSuccess: () =>
                    toast.success(`Tips Payable set to ${acct.name}`),
                  onError: (e: any) => toast.error(e?.message ?? "Could not save"),
                },
              );
            }}
            disabled={liabLoading || liabilityAccounts.length === 0}
          >
            <SelTrigger>
              <SelValue
                placeholder={
                  liabLoading
                    ? "Loading…"
                    : liabilityAccounts.length === 0
                    ? "No liability accounts in QBO"
                    : "Pick a liability account"
                }
              />
            </SelTrigger>
            <SelContent>
              <SelItem value="__none__" disabled>
                <span className="text-text-tertiary">Pick a liability account</span>
              </SelItem>
              {liabilityAccounts.map((a) => (
                <SelItem key={a.id} value={a.id}>
                  {a.name}{" "}
                  <span className="text-text-tertiary">({a.type})</span>
                </SelItem>
              ))}
            </SelContent>
          </Sel>
          {currentTipsName && (
            <p className="mt-1 text-xs text-text-tertiary">
              Currently routing tips to <strong>{currentTipsName}</strong>.
            </p>
          )}
        </div>
        <Button
          onClick={async () => {
            try {
              const r = await syncTips.mutateAsync();
              if (r.processed === 0) {
                toast.success("No tips ready to sync");
              } else {
                toast.success(
                  `Synced ${r.succeeded} of ${r.processed} tip${r.processed === 1 ? "" : "s"} to QBO`,
                );
              }
            } catch (e: any) {
              toast.error(e?.message ?? "Could not sync tips");
            }
          }}
          disabled={syncTips.isPending || !currentTipsId}
          size="sm"
        >
          {syncTips.isPending ? "Syncing…" : "Sync tips now"}
        </Button>
      </div>
      {!currentTipsId && (
        <p className="mt-3 text-xs text-text-tertiary">
          Pick a Tips Payable account before syncing — Snout needs a
          liability account to credit when tips post.
        </p>
      )}
    </div>
  );
}

// 6.6c: Credit ledger. Operator picks four GL accounts (three deferred-revenue
// liabilities + one expired-credits income), then runs the sync to post a
// Journal Entry per credit_ledger row. Per-credit-type liability split keeps
// daycare half-day, daycare full-day, and boarding-night balances visible
// separately on the balance sheet.
//
// Snout posts these JE shapes per ledger row:
//   purchase     -> Debit Undeposited Funds, Credit each Deferred [type]
//   consumption  -> Debit Deferred [type],   Credit Service Income
//   expiration   -> Debit Deferred [type],   Credit Expired Credits Income
//   refund       -> Debit Deferred [type],   Credit Undeposited Funds
function CreditAccountsCard() {
  const { data: settings } = useQuickBooksAccountSettings();
  const { data: liabilityAccounts = [], isLoading: liabLoading } =
    useQuickBooksLiabilityAccounts();
  const { data: incomeAccounts = [], isLoading: incomeLoading } =
    useQuickBooksIncomeAccounts();
  const setCredit = useSetQuickBooksCreditAccount();
  const syncCredits = useSyncQuickBooksCreditLedger();

  const fullId = settings?.default_deferred_daycare_full_account_id ?? "";
  const fullName = settings?.default_deferred_daycare_full_account_name ?? null;
  const halfId = settings?.default_deferred_daycare_half_account_id ?? "";
  const halfName = settings?.default_deferred_daycare_half_account_name ?? null;
  const boardingId = settings?.default_deferred_boarding_account_id ?? "";
  const boardingName = settings?.default_deferred_boarding_account_name ?? null;
  const expiredId = settings?.default_expired_credits_income_account_id ?? "";
  const expiredName =
    settings?.default_expired_credits_income_account_name ?? null;

  const allLiabilityPicked = !!fullId && !!halfId && !!boardingId;
  const ready = allLiabilityPicked && !!expiredId;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-3">
        <div className="font-medium text-foreground">Credit packages</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          Customers pay up front for daycare and boarding credits, so the
          revenue is deferred until each credit is redeemed. Pick a separate
          QBO Liability account for each credit type so the balance sheet
          shows half-day, full-day, and boarding-night liability separately.
          Snout posts a Journal Entry per ledger row — purchases debit
          Undeposited Funds and credit the matching liability; consumption
          debits the liability and credits Service Income; expirations debit
          the liability and credit the Expired Credits income account you
          choose below.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CreditAccountPicker
          label="Daycare half day"
          slot="deferred_daycare_half"
          accounts={liabilityAccounts}
          loading={liabLoading}
          currentId={halfId}
          currentName={halfName}
          setCredit={setCredit}
          kind="liability"
        />
        <CreditAccountPicker
          label="Daycare full day"
          slot="deferred_daycare_full"
          accounts={liabilityAccounts}
          loading={liabLoading}
          currentId={fullId}
          currentName={fullName}
          setCredit={setCredit}
          kind="liability"
        />
        <CreditAccountPicker
          label="Boarding nights"
          slot="deferred_boarding"
          accounts={liabilityAccounts}
          loading={liabLoading}
          currentId={boardingId}
          currentName={boardingName}
          setCredit={setCredit}
          kind="liability"
        />
        <CreditAccountPicker
          label="Expired credits income"
          slot="expired_credits_income"
          accounts={incomeAccounts}
          loading={incomeLoading}
          currentId={expiredId}
          currentName={expiredName}
          setCredit={setCredit}
          kind="income"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {!ready && (
          <p className="text-xs text-text-tertiary">
            Pick all four accounts before syncing.
          </p>
        )}
        <Button
          onClick={async () => {
            try {
              const r = await syncCredits.mutateAsync();
              if (r.processed === 0) {
                toast.success("No credit-ledger rows ready to sync");
              } else {
                toast.success(
                  `Synced ${r.succeeded} of ${r.processed} ledger row${r.processed === 1 ? "" : "s"} to QBO`,
                );
              }
            } catch (e: any) {
              toast.error(e?.message ?? "Could not sync credit ledger");
            }
          }}
          disabled={syncCredits.isPending || !ready}
          size="sm"
        >
          {syncCredits.isPending ? "Syncing…" : "Sync credit ledger now"}
        </Button>
      </div>
    </div>
  );
}

function CreditAccountPicker({
  label,
  slot,
  accounts,
  loading,
  currentId,
  currentName,
  setCredit,
  kind,
}: {
  label: string;
  slot: CreditAccountSlot;
  accounts: Array<{ id: string; name: string; type: string }>;
  loading: boolean;
  currentId: string;
  currentName: string | null;
  setCredit: ReturnType<typeof useSetQuickBooksCreditAccount>;
  kind: "liability" | "income";
}) {
  const placeholder = loading
    ? "Loading…"
    : accounts.length === 0
      ? kind === "liability"
        ? "No liability accounts in QBO"
        : "No income accounts in QBO"
      : kind === "liability"
        ? "Pick a liability account"
        : "Pick an income account";
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
        {label}
      </label>
      <Sel
        value={currentId || "__none__"}
        onValueChange={(v) => {
          if (v === "__none__") return;
          const acct = accounts.find((a) => a.id === v);
          if (!acct) return;
          setCredit.mutate(
            { slot, account: { id: acct.id, name: acct.name } },
            {
              onSuccess: () => toast.success(`${label} set to ${acct.name}`),
              onError: (e: any) => toast.error(e?.message ?? "Could not save"),
            },
          );
        }}
        disabled={loading || accounts.length === 0}
      >
        <SelTrigger>
          <SelValue placeholder={placeholder} />
        </SelTrigger>
        <SelContent>
          <SelItem value="__none__" disabled>
            <span className="text-text-tertiary">{placeholder}</span>
          </SelItem>
          {accounts.map((a) => (
            <SelItem key={a.id} value={a.id}>
              {a.name} <span className="text-text-tertiary">({a.type})</span>
            </SelItem>
          ))}
        </SelContent>
      </Sel>
      {currentName && (
        <p className="mt-1 text-xs text-text-tertiary">
          Currently <strong>{currentName}</strong>.
        </p>
      )}
    </div>
  );
}

// Deposit-prepayment series (PR-2): Customer Deposits. A deposit taken before
// a reservation is a customer prepayment — cash received against a liability,
// not earned revenue. The operator picks the Liability account the deposit
// cash sits in until fulfillment, plus the Income account that captures a
// forfeited (non-refundable) deposit. The dedicated deposit sync (shipping
// next) posts a Journal Entry per deposit lifecycle event; collect/refund
// reuse the existing Undeposited Funds account configured under Payouts.
function CustomerDepositsCard() {
  const { data: settings } = useQuickBooksAccountSettings();
  const { data: liabilityAccounts = [], isLoading: liabLoading } =
    useQuickBooksLiabilityAccounts();
  const { data: incomeAccounts = [], isLoading: incomeLoading } =
    useQuickBooksIncomeAccounts();
  const setCredit = useSetQuickBooksCreditAccount();

  const liabilityId =
    settings?.default_customer_deposit_liability_account_id ?? "";
  const liabilityName =
    settings?.default_customer_deposit_liability_account_name ?? null;
  const forfeitId = settings?.default_forfeited_deposit_income_account_id ?? "";
  const forfeitName =
    settings?.default_forfeited_deposit_income_account_name ?? null;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-3">
        <div className="font-medium text-foreground">Customer deposits</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          A deposit taken before a reservation is a customer prepayment — cash
          received against a liability, not earned revenue. Pick the QBO
          Liability account the deposit cash sits in until the booking is
          fulfilled, plus the Income account that captures a forfeited
          (non-refundable) deposit. Snout posts a Journal Entry per deposit:
          collection debits Undeposited Funds and credits this liability;
          forfeiture debits the liability and credits Forfeited Deposit Income;
          a refund debits the liability and credits Undeposited Funds.
          (Undeposited Funds is the account set under Processor payouts.)
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CreditAccountPicker
          label="Customer deposits liability"
          slot="customer_deposit_liability"
          accounts={liabilityAccounts}
          loading={liabLoading}
          currentId={liabilityId}
          currentName={liabilityName}
          setCredit={setCredit}
          kind="liability"
        />
        <CreditAccountPicker
          label="Forfeited deposit income"
          slot="forfeited_deposit_income"
          accounts={incomeAccounts}
          loading={incomeLoading}
          currentId={forfeitId}
          currentName={forfeitName}
          setCredit={setCredit}
          kind="income"
        />
      </div>

      <p className="mt-3 text-xs text-text-tertiary">
        Deposit sync to QuickBooks activates once both accounts are chosen.
      </p>
    </div>
  );
}

// 6.6a: Processor payouts. Two halves:
//   1. Pick the QBO Expense account where merchant fees post.
//   2. Sync any payouts that are 'ready' to QBO Bank Deposits.
function PayoutsCard() {
  const { data: settings } = useQuickBooksAccountSettings();
  const { data: feeAccounts = [], isLoading: feeLoading } = useQuickBooksFeeAccounts();
  const setFee = useSetQuickBooksFeeAccount();
  const syncPayouts = useSyncQuickBooksPayouts();
  const ingestPayouts = useIngestStripePayouts();

  const currentFeeId = settings?.default_fee_account_id ?? "";
  const currentFeeName = settings?.default_fee_account_name ?? null;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-3">
        <div className="font-medium text-foreground">Processor payouts</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          Stripe and Helcim batch your charges into daily/weekly payouts and
          deduct fees before depositing the net to your bank. Snout posts
          one QBO Journal Entry per payout: debit the bank for the net,
          debit the fee account for the fees, credit Undeposited Funds for
          the gross. Reconciles cleanly against your bank statement.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
            Fee account
          </label>
          <Sel
            value={currentFeeId || "__none__"}
            onValueChange={(v) => {
              if (v === "__none__") return;
              const acct = feeAccounts.find((a) => a.id === v);
              if (!acct) return;
              setFee.mutate(
                { id: acct.id, name: acct.name },
                {
                  onSuccess: () =>
                    toast.success(`Fee account set to ${acct.name}`),
                  onError: (e: any) => toast.error(e?.message ?? "Could not save"),
                },
              );
            }}
            disabled={feeLoading || feeAccounts.length === 0}
          >
            <SelTrigger>
              <SelValue
                placeholder={
                  feeLoading
                    ? "Loading…"
                    : feeAccounts.length === 0
                    ? "No expense accounts in QBO"
                    : "Pick an expense account"
                }
              />
            </SelTrigger>
            <SelContent>
              <SelItem value="__none__" disabled>
                <span className="text-text-tertiary">Pick an expense account</span>
              </SelItem>
              {feeAccounts.map((a) => (
                <SelItem key={a.id} value={a.id}>
                  {a.name}{" "}
                  <span className="text-text-tertiary">({a.type})</span>
                </SelItem>
              ))}
            </SelContent>
          </Sel>
          {currentFeeName && (
            <p className="mt-1 text-xs text-text-tertiary">
              Currently routing fees to <strong>{currentFeeName}</strong>.
            </p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Button
            onClick={async () => {
              try {
                const r = await ingestPayouts.mutateAsync();
                if (r.payouts_inserted === 0) {
                  toast.success("No new Stripe payouts since last ingest");
                } else {
                  toast.success(
                    `Ingested ${r.payouts_inserted} new payout${r.payouts_inserted === 1 ? "" : "s"} from Stripe`,
                  );
                }
              } catch (e: any) {
                toast.error(e?.message ?? "Could not ingest Stripe payouts");
              }
            }}
            disabled={ingestPayouts.isPending}
            size="sm"
            variant="outline"
          >
            {ingestPayouts.isPending ? "Pulling…" : "Pull from Stripe"}
          </Button>
          <Button
            onClick={async () => {
              try {
                const r = await syncPayouts.mutateAsync();
                if (r.processed === 0) {
                  toast.success("No payouts ready to sync");
                } else {
                  toast.success(
                    `Synced ${r.succeeded} of ${r.processed} payout${r.processed === 1 ? "" : "s"} to QBO`,
                  );
                }
              } catch (e: any) {
                toast.error(e?.message ?? "Could not sync payouts");
              }
            }}
            disabled={syncPayouts.isPending || !currentFeeId}
            size="sm"
          >
            {syncPayouts.isPending ? "Syncing…" : "Sync payouts now"}
          </Button>
        </div>
      </div>
      {!currentFeeId && (
        <p className="mt-3 text-xs text-text-tertiary">
          Pick a fee account before syncing — the journal entry needs an
          expense account to debit for the processor fees.
        </p>
      )}
      <p className="mt-3 text-xs text-text-tertiary">
        Pull from Stripe ingests payouts since the last run. A daily cron
        job (03:15 UTC) does this automatically; the manual button is for
        catching up after Stripe Connect setup or backfilling.
      </p>
    </div>
  );
}

// 6.5: Reconciliation export. One click downloads a CSV listing every
// QBO entity mapping with the Snout-side display name + amount, so the
// operator can spot-check against a QBO transaction list at month end.
function ReconciliationCard() {
  const download = useDownloadQuickBooksMappingReport();
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">Reconciliation</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            Download a CSV of every QBO entity mapping with display name,
            amount, and sync state. Use it at month end to spot-check
            against a QBO transaction list.
          </div>
        </div>
        <Button
          onClick={async () => {
            try {
              const n = await download.mutateAsync();
              toast.success(`Exported ${n} mapping${n === 1 ? "" : "s"}.`);
            } catch (e: any) {
              toast.error(e?.message ?? "Could not export mappings");
            }
          }}
          disabled={download.isPending}
          size="sm"
          variant="outline"
        >
          {download.isPending ? "Building CSV..." : "Download CSV"}
        </Button>
      </div>
    </div>
  );
}

// 6.4.5a: Read-only display of the per-org QBO tax-code cache, plus a
// manual refresh. Tax codes are auto-pulled at OAuth connect; the
// refresh button is for cases where the operator changes their QBO
// tax setup later (adds a new agency, edits a rate, etc.) and wants
// Snout to pick up the new shape immediately.
function TaxCodesCard() {
  const taxCodes = useQuickBooksTaxCodes();
  const refresh = useRefreshQuickBooksTaxCodes();

  const sortedCodes: QuickBooksTaxCode[] = taxCodes.data ?? [];

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">Tax codes</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            Imported from your QuickBooks Online tax setup. Attach a tax
            code to each service or retail product so invoices sync with
            the correct tax. QBO is the source of truth; refresh after
            you add or edit tax codes there.
          </div>
        </div>
        <Button
          onClick={async () => {
            try {
              const r = await refresh.mutateAsync();
              toast.success(
                `Imported ${r.codes_imported} tax code${r.codes_imported === 1 ? "" : "s"} and ${r.rates_imported} rate${r.rates_imported === 1 ? "" : "s"}.`,
              );
            } catch (e: any) {
              toast.error(e?.message ?? "Could not refresh tax codes");
            }
          }}
          disabled={refresh.isPending}
          size="sm"
          variant="outline"
        >
          {refresh.isPending ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="mt-3 text-xs">
        {taxCodes.isLoading ? (
          <span className="text-text-tertiary">Loading tax codes...</span>
        ) : sortedCodes.length === 0 ? (
          <span className="text-text-tertiary">
            No tax codes cached yet. Click Refresh to import them from
            QuickBooks.
          </span>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {sortedCodes.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{c.name}</div>
                  <div className="text-text-tertiary">
                    {c.taxable
                      ? c.rate_summary ?? "No rates linked"
                      : "Non-taxable"}
                  </div>
                </div>
                {c.taxable && c.combined_rate_basis_points > 0 && (
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-text-secondary">
                    {(c.combined_rate_basis_points / 100).toFixed(2)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Payment sync card. Same shape as InvoiceSyncCard. Refunds (status =
// 'refunded') are skipped by the worker until 6.4b ships the
// RefundReceipt flow, so the count math represents only the
// succeeded path for now.
function PaymentSyncCard({
  counts,
  loading,
  isPending,
  onSyncAll,
}: {
  counts: SyncCounts | undefined;
  loading: boolean;
  isPending: boolean;
  onSyncAll: () => void;
}) {
  const synced = counts?.synced ?? 0;
  const total = counts?.total ?? 0;
  const failed = counts?.failed ?? 0;
  const pending = total - synced - failed;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">Payments</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            From succeeded Snout payments. Each payment links to its QBO
            invoice; first sync auto-picks an Undeposited Funds or Bank
            account in QBO. Refunds are deferred to a follow-up batch.
          </div>
        </div>
        <Button onClick={onSyncAll} disabled={isPending} size="sm">
          {isPending ? "Queueing..." : "Sync all"}
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        {loading ? (
          <span className="text-text-tertiary">Loading counts...</span>
        ) : (
          <>
            <span className="text-foreground">
              <span className="font-semibold">{synced}</span>
              <span className="text-text-tertiary"> / {total}</span>
              <span className="ml-1 text-text-tertiary">synced</span>
            </span>
            {pending > 0 && (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-text-secondary">
                {pending} pending
              </span>
            )}
            {failed > 0 && (
              <span className="rounded-full border border-destructive/30 bg-destructive-light px-2 py-0.5 font-medium text-destructive">
                {failed} failed
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Invoice sync card. Different shape from the customer/item cards
// because invoices are processed exclusively through the auto-sync
// worker. Pressing "Sync all" here just bulk-enqueues invoices into
// the queue table; the existing cron-driven worker drains them.
// Progress is visible in the AutoSyncPanel below.
function InvoiceSyncCard({
  counts,
  loading,
  isPending,
  onSyncAll,
}: {
  counts: SyncCounts | undefined;
  loading: boolean;
  isPending: boolean;
  onSyncAll: () => void;
}) {
  const synced = counts?.synced ?? 0;
  const total = counts?.total ?? 0;
  const failed = counts?.failed ?? 0;
  const pending = total - synced - failed;

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">Invoices</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            From non-draft Snout invoices. Synced through the auto-sync worker so
            progress shows in the activity panel below. Customers and items must be
            synced first; the worker retries invoices that depend on entities still
            in flight.
          </div>
        </div>
        <Button onClick={onSyncAll} disabled={isPending} size="sm">
          {isPending ? "Queueing..." : "Sync all"}
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        {loading ? (
          <span className="text-text-tertiary">Loading counts...</span>
        ) : (
          <>
            <span className="text-foreground">
              <span className="font-semibold">{synced}</span>
              <span className="text-text-tertiary"> / {total}</span>
              <span className="ml-1 text-text-tertiary">synced</span>
            </span>
            {pending > 0 && (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-text-secondary">
                {pending} pending
              </span>
            )}
            {failed > 0 && (
              <span className="rounded-full border border-destructive/30 bg-destructive-light px-2 py-0.5 font-medium text-destructive">
                {failed} failed
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SyncCard({
  title,
  subtitle,
  counts,
  loading,
  syncing,
  progress,
  onSync,
  onSyncAll,
  onCancel,
}: {
  title: string;
  subtitle: string;
  counts: SyncCounts | undefined;
  loading: boolean;
  syncing: boolean;
  progress: SyncAllProgress;
  onSync: () => void;
  onSyncAll: () => void;
  onCancel: () => void;
}) {
  const synced = counts?.synced ?? 0;
  const total = counts?.total ?? 0;
  const failed = counts?.failed ?? 0;
  const allRunning = progress.running;

  // While Sync all is running we hide the per-batch button to avoid
  // double-invocation and surface the progress strip instead.
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground">{title}</div>
          <div className="mt-0.5 text-xs text-text-tertiary">{subtitle}</div>
        </div>
        {allRunning ? (
          <Button onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
        ) : (
          <div className="flex shrink-0 gap-1">
            <Button onClick={onSync} disabled={syncing} size="sm" variant="outline">
              {syncing ? "..." : "Sync now"}
            </Button>
            <Button onClick={onSyncAll} disabled={syncing} size="sm">
              Sync all
            </Button>
          </div>
        )}
      </div>

      {allRunning && (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent-light/40 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              Syncing... {synced + progress.totalCreated + progress.totalUpdated} / {total}
            </span>
            <span className="text-text-tertiary">
              batch {progress.batches}
            </span>
          </div>
          <div className="mt-1 text-text-tertiary">
            {progress.totalCreated} created, {progress.totalUpdated} updated,{" "}
            {progress.totalUnchanged} unchanged
            {progress.totalFailed > 0 && (
              <>, {progress.totalFailed} failed</>
            )}
          </div>
          {/* Visual progress bar; the count math above is what's authoritative. */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{
                width: `${total > 0 ? Math.min(100, ((synced + progress.totalCreated + progress.totalUpdated) / total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {!allRunning && progress.batches > 0 && (
        <div className="mt-3 rounded-md border border-border-subtle bg-background p-2 text-xs text-text-secondary">
          Last sync all: {progress.batches} batch{progress.batches === 1 ? "" : "es"},{" "}
          {progress.totalCreated} created, {progress.totalUpdated} updated,{" "}
          {progress.totalUnchanged} unchanged
          {progress.totalFailed > 0 && (
            <>, <span className="text-destructive">{progress.totalFailed} failed</span></>
          )}
          {progress.lastError && (
            <div className="mt-1 text-destructive">Stopped: {progress.lastError}</div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs">
        {loading ? (
          <span className="text-text-tertiary">Loading counts...</span>
        ) : (
          <>
            <span className="text-foreground">
              <span className="font-semibold">{synced}</span>
              <span className="text-text-tertiary"> / {total}</span>
              <span className="ml-1 text-text-tertiary">synced</span>
            </span>
            {failed > 0 && (
              <span className="rounded-full border border-destructive/30 bg-destructive-light px-2 py-0.5 font-medium text-destructive">
                {failed} failed
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Auto-sync panel: shows the live state of the outbox + cron pipeline.
// Always rendered when QBO is connected so operators can see that
// auto-sync is healthy (or notice when it isn't). Polls every 30s.
function AutoSyncPanel() {
  const { data: status, isLoading } = useQuickBooksSyncQueueStatus();
  if (isLoading || !status) return null;

  const pending = status.pending_count;
  const processing = status.processing_count;
  const lastProcessed = status.last_processed_at;
  const oldestPending = status.oldest_pending_at;

  // Health heuristic: if the oldest pending row has been waiting more
  // than 5 minutes, something is probably stuck. Surface a warning.
  const stuck =
    oldestPending && Date.now() - new Date(oldestPending).getTime() > 5 * 60 * 1000;

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-foreground">Auto-sync activity</h4>
          <p className="mt-1 text-xs text-text-secondary">
            New customers and services added in Snout sync to QuickBooks
            automatically. The worker runs every minute; expect changes to land
            in QBO within ~60 seconds.
          </p>
        </div>
        {stuck && (
          <span className="rounded-full border border-warning/40 bg-warning-light px-2.5 py-1 text-xs font-medium text-warning">
            Backlog
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Waiting" value={pending} hint={pending === 0 ? "all caught up" : "in queue"} />
        <Stat
          label="Retrying"
          value={processing}
          hint={processing === 0 ? "no retries pending" : "with backoff"}
        />
        <Stat
          label="Last sync"
          value={lastProcessed ? formatRelativeShort(lastProcessed) : "never"}
          hint={lastProcessed ? new Date(lastProcessed).toLocaleString() : "waiting for first event"}
        />
      </div>

      {stuck && oldestPending && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning-light p-3 text-xs text-warning">
          The oldest pending item has been waiting since{" "}
          {new Date(oldestPending).toLocaleString()}. Check that the cron
          service-role key is configured (one-time setup), and look for entries
          in the Failed Syncs panel.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-text-tertiary">{hint}</div>
    </div>
  );
}

function formatRelativeShort(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Failed Syncs panel: lists every mapping in 'failed' state with the
// entity name and Intuit's error message, plus per-row Retry and a
// bulk "Retry all". Hidden entirely when there are no failures.
function FailedSyncsPanel() {
  const { data: failures, isLoading } = useQuickBooksFailedMappings();
  const retryOne = useRetryFailedMapping();
  const resetAll = useResetFailedMappings();
  const allCustomers = useSyncAllQuickBooksCustomers();
  const allItems = useSyncAllQuickBooksItems();

  const handleRetryAll = async () => {
    try {
      const n = await resetAll.mutateAsync(undefined);
      toast.success(`${n} mapping${n === 1 ? "" : "s"} reset to pending. Starting Sync all...`);
      // Kick both syncs; each one quickly no-ops if there's nothing
      // pending in its table.
      allCustomers.start();
      allItems.start();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reset failed mappings");
    }
  };

  const handleRetryOne = async (mapping: FailedMapping) => {
    try {
      await retryOne.mutateAsync(mapping.id);
      toast.success("Marked for retry. Click Sync now or Sync all to push it.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not retry mapping");
    }
  };

  if (isLoading) return null;
  if (!failures || failures.length === 0) return null;

  // Group failures by their last_error to show repeating reasons once
  // with a count. Helps operators see "300 of these are duplicate name
  // errors" at a glance.
  const errorGroups = new Map<string, number>();
  for (const f of failures) {
    const key = f.last_error ?? "Unknown error";
    errorGroups.set(key, (errorGroups.get(key) ?? 0) + 1);
  }
  const topErrors = Array.from(errorGroups.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive-light/30 p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-destructive">
            {failures.length} sync failure{failures.length === 1 ? "" : "s"}
          </h4>
          <p className="mt-1 text-xs text-text-secondary">
            These entities did not sync. Common causes: an entity with the same
            name already exists in QuickBooks, or an email address is malformed.
            Resolve in Snout or QuickBooks, then click Retry.
          </p>
        </div>
        <Button
          onClick={handleRetryAll}
          disabled={resetAll.isPending}
          size="sm"
        >
          {resetAll.isPending ? "Resetting..." : "Retry all failed"}
        </Button>
      </div>

      {/* Error frequency summary so the operator can see patterns. */}
      <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs">
        <div className="font-medium text-foreground">Most common errors</div>
        <ul className="mt-2 space-y-1">
          {topErrors.map(([err, count]) => (
            <li key={err} className="flex items-start justify-between gap-3">
              <span className="text-text-secondary truncate">{err}</span>
              <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-foreground">
                {count}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Detailed list, capped to 50 visible rows; tell the operator
          the cap if there are more. */}
      <div className="mt-4 max-h-96 overflow-y-auto rounded-md border border-border bg-background">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background-elevated/95">
            <tr className="border-b border-border-subtle text-left text-text-tertiary">
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {failures.slice(0, 50).map((f) => (
              <tr key={f.id} className="border-b border-border-subtle last:border-b-0">
                <td className="px-3 py-2 align-top text-text-tertiary">
                  {f.snout_table === "owners"
                    ? "Owner"
                    : f.snout_table === "services"
                      ? "Service"
                      : f.snout_table === "invoices"
                        ? "Invoice"
                        : "Payment"}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-foreground">{f.entity_name}</div>
                  {f.entity_secondary && (
                    <div className="text-text-tertiary">{f.entity_secondary}</div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-text-secondary">
                  {f.last_error ?? "Unknown"}
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <Button
                    onClick={() => handleRetryOne(f)}
                    size="sm"
                    variant="ghost"
                    disabled={retryOne.isPending}
                  >
                    Retry
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failures.length > 50 && (
        <p className="mt-2 text-xs text-text-tertiary">
          Showing the 50 most recent failures of {failures.length} total. Resolve these,
          click Retry all failed to reset, then re-run Sync all.
        </p>
      )}
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
