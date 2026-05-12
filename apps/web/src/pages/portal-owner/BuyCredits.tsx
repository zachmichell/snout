import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  billing_cycle: string;
  included_credits: Record<string, number> | null;
  validity_days: number | null;
};

function billingLabel(cycle: string): string {
  switch (cycle) {
    case "monthly": return "Billed monthly";
    case "quarterly": return "Billed every 3 months";
    case "annual": return "Billed annually";
    default: return "One-time";
  }
}

function creditChips(map: Record<string, number> | null): string[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, v]) => Number(v) > 0)
    .map(([key, value]) => {
      const n = Number(value);
      switch (key) {
        case "daycare_full_day": return n === 1 ? "1 full day" : `${n} full days`;
        case "daycare_half_day": return n === 1 ? "1 half day" : `${n} half days`;
        case "boarding_night":   return n === 1 ? "1 night" : `${n} nights`;
        case "store_credit_cents": return `${formatCents(n)} store credit`;
        default: {
          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return `${n} × ${label}`;
        }
      }
    })
    .sort();
}

export default function BuyCredits() {
  const { membership } = useAuth();
  const { data: owner, refetch: refetchOwner } = useOwnerRecord();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const purchaseState = searchParams.get("package");
  const [pendingPackageId, setPendingPackageId] = useState<string | null>(null);

  // When we land back from Stripe with ?package=success, the webhook
  // is racing us. Poll the owner row for ~30s so credits appear without
  // a manual refresh in the common case.
  useEffect(() => {
    if (purchaseState !== "success") return;
    let cancelled = false;
    const start = Date.now();
    const tick = async () => {
      if (cancelled) return;
      await refetchOwner();
      qc.invalidateQueries({ queryKey: ["owner-record"] });
      if (Date.now() - start < 30_000) {
        setTimeout(tick, 3_000);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [purchaseState, refetchOwner, qc]);

  const { data: packages, isLoading, error } = useQuery({
    queryKey: ["owner-credit-packages", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async (): Promise<PackageRow[]> => {
      const { data, error } = await supabase
        .from("subscription_packages")
        .select("id, name, description, price_cents, billing_cycle, included_credits, validity_days")
        .eq("organization_id", membership!.organization_id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("price_cents", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        included_credits:
          r.included_credits && typeof r.included_credits === "object"
            ? (r.included_credits as Record<string, number>)
            : null,
      }));
    },
  });

  const handleBuy = async (pkg: PackageRow) => {
    setPendingPackageId(pkg.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-package-checkout-session", {
        body: { package_id: pkg.id, base_url: window.location.origin },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const url = data?.checkout_url as string | undefined;
      if (!url) throw new Error("Couldn't start checkout — no URL returned.");
      window.location.href = url;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start checkout";
      toast.error(message);
      setPendingPackageId(null);
    }
  };

  const dismissBanner = () => {
    searchParams.delete("package");
    setSearchParams(searchParams, { replace: true });
  };

  const full = owner?.daycare_full_day_credits ?? 0;
  const half = owner?.daycare_half_day_credits ?? 0;
  const nights = owner?.boarding_night_credits ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Credits</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Stock up on visits at a discount. Credits apply automatically the next time you book.
        </p>
      </div>

      {purchaseState === "success" && (
        <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success-light p-5 shadow-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
          <div className="flex-1">
            <p className="font-semibold text-foreground">Thanks for your purchase!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your credits will appear in a few seconds. If they don't show up, refresh the page —
              your facility will see the purchase either way.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={dismissBanner}>Dismiss</Button>
        </div>
      )}

      {purchaseState === "cancelled" && (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-semibold text-foreground">Checkout cancelled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No charges were made. You can try again any time.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={dismissBanner}>Dismiss</Button>
        </div>
      )}

      {/* Current balance */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-foreground">Your balance</h2>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <BalanceStat label="Daycare · Full" value={full} />
          <BalanceStat label="Daycare · Half" value={half} />
          <BalanceStat label="Boarding · Nights" value={nights} />
        </dl>
      </section>

      {/* Packages */}
      <section>
        <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Available packages</h2>

        {isLoading ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            {(error as Error).message ?? "Couldn't load packages."}
          </div>
        ) : !packages || packages.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
            <CreditCard className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 text-base text-foreground">No packages right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your facility hasn't published any credit packages yet. Reach out to them if you'd
              like to pre-purchase visits.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {packages.map((pkg) => {
              const chips = creditChips(pkg.included_credits);
              const isPending = pendingPackageId === pkg.id;
              return (
                <li
                  key={pkg.id}
                  className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {billingLabel(pkg.billing_cycle)}
                      </p>
                      <p className="mt-1 font-display text-lg font-semibold text-foreground">
                        {pkg.name}
                      </p>
                    </div>
                    <p className="font-display text-2xl font-semibold text-foreground whitespace-nowrap">
                      {formatCents(pkg.price_cents)}
                    </p>
                  </div>

                  {chips.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {chips.map((chip) => (
                        <li
                          key={chip}
                          className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground"
                        >
                          {chip}
                        </li>
                      ))}
                    </ul>
                  )}

                  {pkg.description && (
                    <p className="mt-4 text-sm text-muted-foreground">{pkg.description}</p>
                  )}

                  {pkg.validity_days && pkg.validity_days > 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Credits expire {pkg.validity_days} days after purchase.
                    </p>
                  ) : null}

                  <div className="mt-6">
                    <Button
                      onClick={() => handleBuy(pkg)}
                      disabled={isPending || pendingPackageId !== null}
                      className="w-full"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening checkout…
                        </>
                      ) : (
                        <>Buy · {formatCents(pkg.price_cents)}</>
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          You'll be redirected to a secure Stripe checkout. Credits are added to your account
          automatically once your payment clears.
        </p>
      </section>
    </div>
  );
}

function BalanceStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold text-foreground">{value}</dd>
    </div>
  );
}
