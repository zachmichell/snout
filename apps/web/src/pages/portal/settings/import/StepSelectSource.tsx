import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, PawPrint, Syringe, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType, SourceSystem } from "./lib/types";

const DATA_TYPES: { key: DataType; label: string; icon: any; desc: string }[] = [
  { key: "owners", label: "Owners", icon: Users, desc: "Pet parents and contact info" },
  { key: "pets", label: "Pets", icon: PawPrint, desc: "Pet profiles linked to owners" },
  { key: "vaccinations", label: "Vaccinations", icon: Syringe, desc: "Vaccine records per pet" },
  { key: "reservations", label: "Reservation History", icon: CalendarDays, desc: "Past bookings for reporting" },
];

const SOURCES: { key: SourceSystem; label: string; desc: string }[] = [
  { key: "gingr", label: "Gingr", desc: "Auto-maps Gingr export columns" },
  { key: "petexec", label: "PetExec", desc: "Auto-maps PetExec export columns" },
  { key: "daysmart", label: "DaySmart Pet", desc: "Auto-maps DaySmart export columns" },
  { key: "other", label: "Other / Generic CSV", desc: "Map columns manually" },
];

export default function StepSelectSource({
  dataType,
  source,
  onChange,
  onNext,
}: {
  dataType: DataType | null;
  source: SourceSystem | null;
  onChange: (dt: DataType | null, src: SourceSystem | null) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-lg mb-3">What are you importing?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DATA_TYPES.map((d) => {
            const Icon = d.icon;
            const active = dataType === d.key;
            return (
              <button
                key={d.key}
                onClick={() => onChange(d.key, source)}
                className={cn(
                  "text-left rounded-xl border p-4 transition-all bg-card hover:border-accent/60",
                  active ? "border-accent ring-2 ring-accent/30 bg-accent-light" : "border-border",
                )}
              >
                <Icon className={cn("h-6 w-6 mb-2", active ? "text-accent" : "text-text-secondary")} />
                <div className="font-medium text-sm">{d.label}</div>
                <div className="text-xs text-text-secondary mt-1">{d.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg mb-3">Where are you importing from?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SOURCES.map((s) => {
            const active = source === s.key;
            return (
              <button
                key={s.key}
                onClick={() => onChange(dataType, s.key)}
                className={cn(
                  "text-left rounded-xl border p-4 transition-all bg-card hover:border-accent/60",
                  active ? "border-accent ring-2 ring-accent/30 bg-accent-light" : "border-border",
                )}
              >
                <div className="font-medium text-sm">{s.label}</div>
                <div className="text-xs text-text-secondary mt-1">{s.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!dataType || !source}>
          Next
        </Button>
      </div>
    </div>
  );
}
