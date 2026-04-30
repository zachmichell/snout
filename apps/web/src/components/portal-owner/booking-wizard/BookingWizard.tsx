import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import StepService from "./StepService";
import StepPets from "./StepPets";
import StepDateTime from "./StepDateTime";
import StepGroomer from "./StepGroomer";
import StepSlot from "./StepSlot";
import StepReview from "./StepReview";

export type WizardService = {
  id: string;
  name: string;
  description: string | null;
  duration_type: "hourly" | "half_day" | "full_day" | "overnight" | "multi_night" | "flat";
  base_price_cents: number;
  max_pets_per_booking: number | null;
  location_id: string | null;
  module: string;
  default_duration_minutes: number | null;
};

export type WizardGroomer = {
  id: string;
  display_name: string;
  bio: string | null;
  working_days: string[];
};

export type WizardPet = {
  id: string;
  name: string;
  breed: string | null;
  species: string;
  photo_url: string | null;
  vaxStatus: "current" | "expiring" | "expired" | "none";
};

export type WizardDateTime = {
  date: string; // yyyy-mm-dd (start date / check-in)
  endDate?: string; // yyyy-mm-dd (check-out for boarding)
  startTime: string; // HH:mm
  endTime?: string; // HH:mm (daycare/boarding)
  hours?: number; // hourly
};

export type WizardState = {
  locationId: string | null;
  service: WizardService | null;
  pets: WizardPet[];
  datetime: WizardDateTime | null;
  notes: string;
  // Grooming-flow only:
  groomer: WizardGroomer | null;
  /// "yyyy-MM-dd" — date for the slot picker. Distinct from datetime.date so
  /// flows don't accidentally cross-pollinate state.
  groomingDate: string;
  /// "HH:mm" — slot picked from the get_groomer_available_slots RPC.
  groomingSlot: string | null;
};

const STEPS_DEFAULT = ["Service", "Pets", "Date & Time", "Review"];
const STEPS_GROOMING = ["Service", "Pets", "Groomer", "Pick a time", "Review"];

/// Returns the visible step labels and a lookup for "what step component to
/// render at this index given the current state".
function effectiveSteps(state: WizardState): string[] {
  return state.service?.module === "grooming" ? STEPS_GROOMING : STEPS_DEFAULT;
}

export default function BookingWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    locationId: null,
    service: null,
    pets: [],
    datetime: null,
    notes: "",
    groomer: null,
    groomingDate: "",
    groomingSlot: null,
  });
  const qc = useQueryClient();

  const reset = () => {
    setStep(0);
    setState({
      locationId: null,
      service: null,
      pets: [],
      datetime: null,
      notes: "",
      groomer: null,
      groomingDate: "",
      groomingSlot: null,
    });
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const visibleSteps = effectiveSteps(state);
  const next = () => setStep((s) => Math.min(visibleSteps.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const onComplete = () => {
    qc.invalidateQueries({ queryKey: ["owner-bookings"] });
    qc.invalidateQueries({ queryKey: ["owner-upcoming"] });
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Book a visit</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-1 pb-2">
          {visibleSteps.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    done || active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:inline",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                {i < visibleSteps.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1 transition-colors",
                      done ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {visibleSteps[step] === "Service" && (
            <StepService state={state} setState={setState} onNext={next} />
          )}
          {visibleSteps[step] === "Pets" && (
            <StepPets state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {visibleSteps[step] === "Date & Time" && (
            <StepDateTime state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {visibleSteps[step] === "Groomer" && (
            <StepGroomer state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {visibleSteps[step] === "Pick a time" && (
            <StepSlot state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {visibleSteps[step] === "Review" && (
            <StepReview state={state} setState={setState} onBack={back} onComplete={onComplete} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
