import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const DEFAULT_MODULE_PRICES_CENTS: Record<string, number> = {
  daycare: 4900,
  boarding: 7900,
  grooming: 4900,
  training: 4900,
  retail: 2900,
};

export type OrgStatus = "trial" | "active" | "paused" | "past_due" | "cancelled";

export function useSubscriptionStatus() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  return useQuery({
    queryKey: ["subscription-status", orgId],
    enabled: !!orgId,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [orgRes, subRes, modsRes, locsRes] = await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, status, trial_ends_at, currency, created_at")
          .eq("id", orgId!)
          .single(),
        supabase
          .from("subscriptions")
          .select("*")
          .eq("organization_id", orgId!)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("subscription_modules")
          .select("module, location_id, enabled, price_cents")
          .eq("organization_id", orgId!)
          .is("deleted_at", null),
        supabase
          .from("locations")
          .select("id, name")
          .eq("organization_id", orgId!)
          .eq("active", true)
          .is("deleted_at", null),
      ]);

      const org = orgRes.data;
      const sub = subRes.data;
      const modules = modsRes.data ?? [];
      const locations = locsRes.data ?? [];

      const orgStatus = (org?.status ?? "trial") as OrgStatus;
      const trialEndsAt = org?.trial_ends_at ? new Date(org.trial_ends_at) : null;
      const now = new Date();
      const trialDaysRemaining = trialEndsAt
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000))
        : 0;
      const trialProgress = trialEndsAt
        ? Math.min(100, Math.max(0, ((30 - trialDaysRemaining) / 30) * 100))
        : 0;

      // Compute monthly total from active modules × locations
      let monthlyTotalCents = 0;
      const breakdown: { module: string; locationName: string; priceCents: number }[] = [];
      for (const m of modules.filter((x) => x.enabled)) {
        const price =
          m.price_cents && m.price_cents > 0
            ? m.price_cents
            : DEFAULT_MODULE_PRICES_CENTS[m.module] ?? 0;
        const locName =
          locations.find((l) => l.id === m.location_id)?.name ?? "All locations";
        monthlyTotalCents += price;
        breakdown.push({ module: m.module, locationName: locName, priceCents: price });
      }

      return {
        org,
        subscription: sub,
        locations,
        modules,
        orgStatus,
        trialEndsAt,
        trialDaysRemaining,
        trialProgress,
        monthlyTotalCents,
        breakdown,
        isPaused: orgStatus === "paused",
        isPastDue: orgStatus === "past_due",
        isTrial: orgStatus === "trial",
        isActive: orgStatus === "active",
      };
    },
  });
}
