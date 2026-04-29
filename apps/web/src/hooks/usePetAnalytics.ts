import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { DateRange, dayKey, eachDayInRange } from "@/lib/analytics";

export type PetStats = {
  totalActive: number;
  newPets: number;
  newPetsSeries: { key: string; label: string; count: number }[];
  bySpecies: { species: string; count: number }[];
  byBreed: { breed: string; count: number }[];
  popularServices: { name: string; count: number }[];
};

export function usePetAnalytics(range: DateRange) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  return useQuery<PetStats>({
    enabled: !!orgId,
    staleTime: 60_000,
    queryKey: ["pet-analytics", orgId, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      if (!orgId) throw new Error("no org");

      const [petsRes, newPetsRes, reservationsRes, servicesRes] = await Promise.all([
        supabase
          .from("pets")
          .select("id, species, breed")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .limit(5000),
        supabase
          .from("pets")
          .select("id, created_at")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString())
          .limit(2000),
        supabase
          .from("reservations")
          .select("id, service_id, status")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .gte("start_at", range.from.toISOString())
          .lte("start_at", range.to.toISOString())
          .limit(5000),
        supabase
          .from("services")
          .select("id, name")
          .eq("organization_id", orgId)
          .is("deleted_at", null),
      ]);

      const pets = (petsRes.data ?? []) as Array<{ id: string; species: string | null; breed: string | null }>;
      const newPets = (newPetsRes.data ?? []) as Array<{ id: string; created_at: string }>;
      const reservations = (reservationsRes.data ?? []) as Array<{ id: string; service_id: string | null; status: string }>;
      const services = (servicesRes.data ?? []) as Array<{ id: string; name: string }>;
      const serviceMap = new Map(services.map((s) => [s.id, s.name]));

      // Species
      const speciesMap = new Map<string, number>();
      const breedMap = new Map<string, number>();
      for (const p of pets) {
        const sp = (p.species ?? "Unknown").trim() || "Unknown";
        speciesMap.set(sp, (speciesMap.get(sp) ?? 0) + 1);
        if (p.breed) breedMap.set(p.breed, (breedMap.get(p.breed) ?? 0) + 1);
      }
      const bySpecies = Array.from(speciesMap.entries()).map(([species, count]) => ({ species, count })).sort((a, b) => b.count - a.count);
      const byBreed = Array.from(breedMap.entries()).map(([breed, count]) => ({ breed, count })).sort((a, b) => b.count - a.count).slice(0, 10);

      // New pets series
      const days = eachDayInRange(range);
      const buckets = new Map(days.map((d) => [d.key, { key: d.key, label: d.label, count: 0 }]));
      for (const p of newPets) {
        const k = dayKey(new Date(p.created_at));
        const b = buckets.get(k);
        if (b) b.count += 1;
      }
      const newPetsSeries = Array.from(buckets.values());

      // Popular services
      const svcCounts = new Map<string, number>();
      for (const r of reservations) {
        if (!r.service_id) continue;
        if (r.status === "cancelled" || r.status === "no_show") continue;
        svcCounts.set(r.service_id, (svcCounts.get(r.service_id) ?? 0) + 1);
      }
      const popularServices = Array.from(svcCounts.entries())
        .map(([id, count]) => ({ name: serviceMap.get(id) ?? "—", count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalActive: pets.length,
        newPets: newPets.length,
        newPetsSeries,
        bySpecies,
        byBreed,
        popularServices,
      };
    },
  });
}
