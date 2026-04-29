import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useLocations";
import { useOrgModules } from "@/hooks/useOrgModules";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCentsShort } from "@/lib/money";
import { formatDurationType } from "@/lib/money";
import { priceUnitLabel } from "@/lib/booking";
import type { WizardService, WizardState } from "./BookingWizard";

export default function StepService({
  state,
  setState,
  onNext,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onNext: () => void;
}) {
  const { membership } = useAuth();
  const { data: locations = [] } = useLocations();
  const { data: enabledModules } = useOrgModules();

  const singleLocation = locations.length <= 1;
  const effectiveLocationId = singleLocation ? locations[0]?.id ?? null : state.locationId;

  const { data: services = [], isLoading } = useQuery({
    queryKey: ["owner-services", membership?.organization_id, effectiveLocationId],
    enabled: !!membership?.organization_id && (singleLocation || !!effectiveLocationId),
    queryFn: async () => {
      let q = supabase
        .from("services")
        .select("id, name, description, duration_type, base_price_cents, max_pets_per_booking, location_id, module")
        .eq("organization_id", membership!.organization_id)
        .eq("active", true)
        .is("deleted_at", null)
        .order("name");
      if (effectiveLocationId) {
        q = q.or(`location_id.eq.${effectiveLocationId},location_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data ?? []).filter((s: any) =>
        enabledModules ? enabledModules.has(s.module) : true,
      );
      return filtered as WizardService[];
    },
  });

  const select = (svc: WizardService) => {
    setState((s) => ({
      ...s,
      service: svc,
      locationId: effectiveLocationId,
      // reset downstream selections if service changes
      pets: s.service?.id === svc.id ? s.pets : [],
      datetime: s.service?.id === svc.id ? s.datetime : null,
    }));
    onNext();
  };

  return (
    <div className="space-y-4 py-2">
      {!singleLocation && (
        <div>
          <label className="text-sm font-medium text-foreground">Location</label>
          <Select
            value={state.locationId ?? ""}
            onValueChange={(v) => setState((s) => ({ ...s, locationId: v }))}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l: any) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(singleLocation || state.locationId) && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Choose a service</p>
          {isLoading && <p className="text-sm text-muted-foreground">Loading services…</p>}
          {!isLoading && services.length === 0 && (
            <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              No services available for booking right now.
            </p>
          )}
          <div className="grid gap-3">
            {services.map((svc) => {
              const selected = state.service?.id === svc.id;
              return (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => select(svc)}
                  className={cn(
                    "group rounded-xl border p-4 text-left transition-all hover:border-primary hover:shadow-sm",
                    selected ? "border-primary bg-primary-light/40" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-base font-semibold text-foreground">
                          {svc.name}
                        </h3>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {formatDurationType(svc.duration_type)}
                        </span>
                      </div>
                      {svc.description && (
                        <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                          {svc.description}
                        </p>
                      )}
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {formatCentsShort(svc.base_price_cents)}
                        <span className="text-muted-foreground font-normal">
                          {priceUnitLabel(svc.duration_type)}
                        </span>
                      </p>
                    </div>
                    {selected && (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button disabled={!state.service} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
