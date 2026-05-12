import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WizardGroomer, WizardState } from "./BookingWizard";

/**
 * Groomer-pick step. Lists active groomers for the org; tapping one stores
 * it in WizardState.groomer and clears any previously-picked slot (since
 * different groomer = different calendar).
 */
export default function StepGroomer({
  state,
  setState,
  onBack,
  onNext,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onBack: () => void;
  onNext: () => void;
}) {
  const { membership } = useAuth();

  const { data: groomers = [], isLoading } = useQuery({
    queryKey: ["wizard-groomers", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("groomers")
        .select("id, display_name, bio, working_days")
        .eq("organization_id", membership!.organization_id)
        .eq("status", "active")
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as WizardGroomer[];
    },
  });

  const select = (g: WizardGroomer) => {
    setState((s) => ({
      ...s,
      groomer: g,
      // Different groomer → different calendar; clear stale slot.
      groomingSlot: s.groomer?.id === g.id ? s.groomingSlot : null,
    }));
  };

  const condensedDays = (days: string[]): string => {
    const order: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const sorted = days
      .map((d) => order[d.toLowerCase()])
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);
    if (sorted.length === 0) return "";
    const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const isContiguous =
      sorted.length >= 3 &&
      sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
    if (isContiguous) return `${short[sorted[0]]}–${short[sorted[sorted.length - 1]]}`;
    return sorted.map((d) => short[d]).join(", ");
  };

  return (
    <div className="space-y-4 py-2">
      {isLoading && <p className="text-sm text-muted-foreground">Loading groomers…</p>}

      {!isLoading && groomers.length === 0 && (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No groomers are currently set up at this facility.
        </p>
      )}

      <div className="grid gap-3">
        {groomers.map((g) => {
          const selected = state.groomer?.id === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => select(g)}
              className={cn(
                "rounded-xl border p-4 text-left transition-all hover:border-primary",
                selected ? "border-primary bg-primary-light/40" : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-base font-semibold text-foreground">
                    {g.display_name}
                  </h3>
                  {g.bio && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{g.bio}</p>
                  )}
                  {g.working_days?.length > 0 && (
                    <p className="mt-2 text-xs font-medium text-muted-foreground">
                      Works {condensedDays(g.working_days)}
                    </p>
                  )}
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

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!state.groomer} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
