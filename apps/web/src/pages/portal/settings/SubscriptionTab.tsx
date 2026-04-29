import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const ALL_MODULES = ["daycare", "boarding", "grooming", "training", "retail"] as const;
type ModuleKey = (typeof ALL_MODULES)[number];

const MODULE_LABEL: Record<ModuleKey, string> = {
  daycare: "Daycare",
  boarding: "Boarding",
  grooming: "Grooming",
  training: "Training",
  retail: "Retail",
};

const STATUS_STYLES: Record<string, string> = {
  trialing: "bg-warning-light text-warning",
  active: "bg-success-light text-success",
  past_due: "bg-destructive-light text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  paused: "bg-teal-light text-teal",
};

export default function SubscriptionTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: subscription } = useQuery({
    queryKey: ["subscription", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .maybeSingle();
      return data;
    },
  });

  const { data: modules = [] } = useQuery({
    queryKey: ["sub-modules", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscription_modules")
        .select("module, enabled")
        .eq("organization_id", orgId!)
        .is("deleted_at", null);
      return data ?? [];
    },
  });

  const enabledSet = new Set(modules.filter((m) => m.enabled).map((m) => m.module));

  return (
    <div className="grid gap-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Plan status</CardTitle>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Badge className={STATUS_STYLES[subscription.status] ?? ""}>
                  {subscription.status}
                </Badge>
              </Field>
              <Field label="Current period">
                <span className="text-sm">
                  {formatDate(subscription.current_period_start)} —{" "}
                  {formatDate(subscription.current_period_end)}
                </span>
              </Field>
              {subscription.trial_ends_at && (
                <Field label="Trial ends">
                  <span className="text-sm">{formatDate(subscription.trial_ends_at)}</span>
                </Field>
              )}
              {subscription.cancel_at_period_end && (
                <Field label="">
                  <span className="text-sm text-destructive">
                    Cancels at end of current period
                  </span>
                </Field>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription on file.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {ALL_MODULES.map((m) => {
              const on = enabledSet.has(m);
              return (
                <div
                  key={m}
                  className={`rounded-lg border p-4 ${
                    on ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-semibold">{MODULE_LABEL[m]}</span>
                    {on ? (
                      <Badge>Active</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Contact us to add</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            To change your plan or modules, contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}
