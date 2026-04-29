import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { speciesIcon } from "@/lib/format";
import { getVaccinationStatus } from "@/lib/vaccines";
import VaccinationStatusBadge from "@/components/portal-owner/VaccinationStatusBadge";
import type { WizardPet, WizardState } from "./BookingWizard";

export default function StepPets({
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
  const { data: owner } = useOwnerRecord();
  const max = state.service?.max_pets_per_booking ?? null;

  const { data: pets = [], isLoading } = useQuery({
    queryKey: ["owner-pets-wizard", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("pets(id, name, breed, species, photo_url, deleted_at, vaccinations(id, expires_on, deleted_at))")
        .eq("owner_id", owner!.id);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.pets)
        .filter((p: any) => p && !p.deleted_at)
        .map((p: any): WizardPet => ({
          id: p.id,
          name: p.name,
          breed: p.breed,
          species: p.species,
          photo_url: p.photo_url,
          vaxStatus: getVaccinationStatus(
            (p.vaccinations ?? []).filter((v: any) => !v.deleted_at),
          ),
        }));
    },
  });

  const toggle = (pet: WizardPet) => {
    setState((s) => {
      const exists = s.pets.find((p) => p.id === pet.id);
      if (exists) return { ...s, pets: s.pets.filter((p) => p.id !== pet.id) };
      if (max && s.pets.length >= max) return s;
      return { ...s, pets: [...s.pets, pet] };
    });
  };

  // Auto-select when the owner has exactly one pet — the typical case.
  // Saves a tap on a step that otherwise demands one. We only run this
  // once per pets-load to avoid undoing manual deselections.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current) return;
    if (pets.length === 1 && state.pets.length === 0) {
      autoSelected.current = true;
      setState((s) => ({ ...s, pets: [pets[0]] }));
    }
  }, [pets, state.pets.length, setState]);

  const selectAll = () => {
    const allowed = max ? pets.slice(0, max) : pets;
    setState((s) => ({ ...s, pets: allowed }));
  };

  const allSelected = pets.length > 0 && state.pets.length === Math.min(pets.length, max ?? pets.length);
  const hasExpired = state.pets.some((p) => p.vaxStatus === "expired");

  return (
    <div className="space-y-4 py-2">
      {max && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          This service allows up to {max} pet{max === 1 ? "" : "s"} per booking.
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading pets…</p>}
      {!isLoading && pets.length === 0 && (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          You don't have any pets on file. Contact your facility to add your pets.
        </p>
      )}

      {pets.length > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {state.pets.length} of {pets.length} selected
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (allSelected ? setState((s) => ({ ...s, pets: [] })) : selectAll())}
            className="h-7 text-xs"
          >
            {allSelected ? "Clear all" : "Select all"}
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pets.map((pet) => {
          const selected = !!state.pets.find((p) => p.id === pet.id);
          const disabled = !selected && !!max && state.pets.length >= max;
          return (
            <button
              key={pet.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(pet)}
              className={cn(
                "group rounded-xl border p-3 text-left transition-all",
                selected
                  ? "border-primary bg-primary-light/40"
                  : "border-border bg-card hover:border-primary",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-3">
                {pet.photo_url ? (
                  <img src={pet.photo_url} alt={pet.name} className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl">
                    {speciesIcon(pet.species)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{pet.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{pet.breed ?? "—"}</p>
                </div>
                {selected && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
              {(pet.vaxStatus === "expired" || pet.vaxStatus === "expiring") && (
                <div className="mt-2.5">
                  <VaccinationStatusBadge status={pet.vaxStatus} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {hasExpired && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-foreground">
            One or more selected pets have expired vaccinations — the facility may require updated records before check-in.
          </p>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button disabled={state.pets.length === 0} onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
