import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PawPrint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useAuth } from "@/hooks/useAuth";
import { calcAge, kgToLbs, speciesIcon } from "@/lib/format";
import { getVaccinationStatus } from "@/lib/vaccines";
import VaccinationStatusBadge from "@/components/portal-owner/VaccinationStatusBadge";
import { Button } from "@/components/ui/button";

export default function OwnerPets() {
  const { membership } = useAuth();
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();

  const { data: org } = useQuery({
    queryKey: ["owner-org-name", membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", membership!.organization_id)
        .maybeSingle();
      return data;
    },
  });

  const { data: pets, isLoading } = useQuery({
    queryKey: ["owner-pets-full", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select(
          "pets(id, name, breed, species, photo_url, date_of_birth, weight_kg, deleted_at, vaccinations(id, expires_on, deleted_at))",
        )
        .eq("owner_id", owner!.id);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.pets)
        .filter((p: any) => p && !p.deleted_at)
        .map((p: any) => ({
          ...p,
          vaccinations: (p.vaccinations ?? []).filter((v: any) => !v.deleted_at),
        }));
    },
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Pets</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Manage your pet profiles and vaccination records
        </p>
      </header>

      {(ownerLoading || isLoading) && (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {!ownerLoading && !isLoading && (!pets || pets.length === 0) && (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <PawPrint className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-medium text-foreground">No pets on file yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact {org?.name ?? "your pet care provider"} to add your pets.
          </p>
        </div>
      )}

      {pets && pets.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {pets.map((pet: any) => {
            const status = getVaccinationStatus(pet.vaccinations);
            const age = calcAge(pet.date_of_birth);
            const lbs = kgToLbs(pet.weight_kg);
            return (
              <article
                key={pet.id}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-5">
                  {pet.photo_url ? (
                    <img
                      src={pet.photo_url}
                      alt={pet.name}
                      className="h-20 w-20 flex-shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-muted text-3xl">
                      {speciesIcon(pet.species)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-display text-xl font-semibold text-foreground truncate">
                        {pet.name}
                      </h2>
                      <VaccinationStatusBadge status={status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground capitalize">
                      {pet.breed ?? "Mixed"} · {pet.species}
                    </p>
                    <dl className="mt-3 space-y-0.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Age:</dt>
                        <dd className="text-foreground">{age ?? "Age unknown"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Weight:</dt>
                        <dd className="text-foreground">
                          {lbs ? `${lbs} lbs` : "Weight not recorded"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="mt-5 flex justify-end">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/portal/pets/${pet.id}`}>View profile</Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
