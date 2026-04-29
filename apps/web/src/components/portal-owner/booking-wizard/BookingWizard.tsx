import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import StepService from "./StepService";
import StepPets from "./StepPets";
import StepDateTime from "./StepDateTime";
import StepReview from "./StepReview";

export type WizardService = {
  id: string;
  name: string;
  description: string | null;
  duration_type: "hourly" | "half_day" | "full_day" | "overnight" | "multi_night";
  base_price_cents: number;
  max_pets_per_booking: number | null;
  location_id: string | null;
  module: string;
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
};

const STEPS = ["Service", "Pets", "Date & Time", "Review"];

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
  });
  const qc = useQueryClient();

  const reset = () => {
    setStep(0);
    setState({ locationId: null, service: null, pets: [], datetime: null, notes: "" });
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
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
          {STEPS.map((label, i) => {
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
                {i < STEPS.length - 1 && (
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
          {step === 0 && (
            <StepService
              state={state}
              setState={setState}
              onNext={next}
            />
          )}
          {step === 1 && (
            <StepPets state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {step === 2 && (
            <StepDateTime state={state} setState={setState} onBack={back} onNext={next} />
          )}
          {step === 3 && (
            <StepReview state={state} setState={setState} onBack={back} onComplete={onComplete} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
