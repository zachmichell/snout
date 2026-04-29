import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSubscriptionStatus, DEFAULT_MODULE_PRICES_CENTS } from "@/hooks/useSubscriptionStatus";
import { formatDate } from "@/lib/format";
import { CreditCard, Calendar, Sparkles } from "lucide-react";

const MODULES: { key: string; label: string }[] = [
  { key: "daycare", label: "Daycare" },
  { key: "boarding", label: "Boarding" },
];

function formatMoney(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

export default function BillingTab() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSubscriptionStatus();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    const result = params.get("checkout");
    if (result === "success") {
      toast.success("Billing added successfully!");
      queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      const next = new URLSearchParams(params);
      next.delete("checkout");
      setParams(next, { replace: true });
    } else if (result === "cancelled") {
      toast.info("Checkout cancelled");
      const next = new URLSearchParams(params);
      next.delete("checkout");
      setParams(next, { replace: true });
    }
  }, [params, setParams, queryClient]);

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const currency = (data.org?.currency as string) ?? "CAD";

  const startCheckout = async (selections: Record<string, boolean>) => {
    setCheckoutLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("create-billing-checkout", {
        body: { module_selections: selections },
      });
      if (error) throw error;
      if (res?.checkout_url) window.location.href = res.checkout_url;
    } catch (e: any) {
      toast.error(e.message ?? "Could not start checkout");
      setCheckoutLoading(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("create-billing-portal");
      if (error) throw error;
      if (res?.url) window.open(res.url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="grid gap-6 max-w-3xl">
      {/* TRIAL */}
      {data.isTrial && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Free trial
              </CardTitle>
              <Badge variant="secondary">{data.trialDaysRemaining} days left</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={data.trialProgress} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {data.trialEndsAt
                ? `Your trial ends on ${formatDate(data.trialEndsAt.toISOString())}. Add billing to continue without interruption.`
                : "Add billing to continue without interruption."}
            </p>
            <Button
              onClick={() => startCheckout({ daycare: true, boarding: true })}
              disabled={checkoutLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {checkoutLoading ? "Loading…" : "Add Billing"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ACTIVE / PAST DUE */}
      {(data.isActive || data.isPastDue) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-base">Subscription</CardTitle>
              <Badge
                className={
                  data.isPastDue
                    ? "bg-destructive/15 text-destructive"
                    : "bg-[hsl(var(--primary)/0.15)] text-primary"
                }
              >
                {data.isPastDue ? "Past due" : "Active"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.subscription?.current_period_end && (
                <Field label="Next billing date">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {formatDate(data.subscription.current_period_end)}
                  </div>
                </Field>
              )}
              <Field label="Monthly total">
                <span className="text-lg font-display font-semibold">
                  {formatMoney(data.monthlyTotalCents, currency)}
                </span>
              </Field>
            </div>

            {data.breakdown.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Modules
                  </p>
                  {data.breakdown.map((b, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="capitalize">
                        {b.module} — <span className="text-muted-foreground">{b.locationName}</span>
                      </span>
                      <span>{formatMoney(b.priceCents, currency)}/mo</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setManageOpen(true)}>
                Manage Subscription
              </Button>
              <Button
                onClick={openPortal}
                disabled={portalLoading}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {portalLoading ? "Loading…" : "Manage Card & Invoices"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CANCELLED / PAUSED */}
      {(data.orgStatus === "cancelled" || data.isPaused) && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Subscription inactive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your subscription is {data.orgStatus}. Add billing to reactivate Snout for your team.
            </p>
            <Button
              onClick={() => startCheckout({ daycare: true, boarding: true })}
              disabled={checkoutLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {checkoutLoading ? "Loading…" : "Add Billing"}
            </Button>
          </CardContent>
        </Card>
      )}

      <ManageSubscriptionDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        currency={currency}
        locations={data.locations}
        existingModules={data.modules}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ManageSubscriptionDialog({
  open,
  onOpenChange,
  currency,
  locations,
  existingModules,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currency: string;
  locations: { id: string; name: string }[];
  existingModules: { module: string; location_id: string | null; enabled: boolean }[];
}) {
  const [saving, setSaving] = useState(false);
  // selections[locationId][module] = boolean
  const [selections, setSelections] = useState<Record<string, Record<string, boolean>>>(() => {
    const init: Record<string, Record<string, boolean>> = {};
    for (const loc of locations) {
      init[loc.id] = {};
      for (const m of MODULES) {
        init[loc.id][m.key] =
          existingModules.some(
            (x) => x.module === m.key && x.location_id === loc.id && x.enabled,
          ) || false;
      }
    }
    return init;
  });

  const total = Object.entries(selections).reduce((sum, [, mods]) => {
    for (const [k, v] of Object.entries(mods)) {
      if (v) sum += DEFAULT_MODULE_PRICES_CENTS[k] ?? 0;
    }
    return sum;
  }, 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build module selections summary (any module enabled on any location)
      const moduleSelections: Record<string, boolean> = {};
      const locationIds: string[] = [];
      for (const [locId, mods] of Object.entries(selections)) {
        const anyEnabled = Object.values(mods).some(Boolean);
        if (anyEnabled) locationIds.push(locId);
        for (const [k, v] of Object.entries(mods)) {
          if (v) moduleSelections[k] = true;
        }
      }
      if (!locationIds.length) {
        toast.error("Select at least one module");
        setSaving(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("create-billing-checkout", {
        body: { module_selections: moduleSelections, location_ids: locationIds },
      });
      if (error) throw error;
      if (data?.checkout_url) window.location.href = data.checkout_url;
    } catch (e: any) {
      toast.error(e.message ?? "Could not update subscription");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Manage Your Subscription</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {locations.map((loc) => (
            <div key={loc.id} className="rounded-lg border border-border p-4">
              <p className="font-display font-semibold text-sm mb-3">{loc.name}</p>
              <div className="space-y-2">
                {MODULES.map((m) => (
                  <label key={m.key} className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selections[loc.id]?.[m.key] ?? false}
                        onCheckedChange={(v) =>
                          setSelections((prev) => ({
                            ...prev,
                            [loc.id]: { ...prev[loc.id], [m.key]: !!v },
                          }))
                        }
                      />
                      <span className="text-sm">{m.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(DEFAULT_MODULE_PRICES_CENTS[m.key], currency)}/mo
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Estimated monthly total</span>
            <span className="font-display text-lg font-semibold">
              {formatMoney(total, currency)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? "Loading…" : "Update Subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
