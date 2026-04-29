import { usePetTraits } from "@/hooks/usePetTraits";
import { TRAIT_CATEGORY_ORDER, categoryLabel, SEVERITY_DOT, type TraitCategory, type TraitSeverity } from "@/lib/traits";
import { cn } from "@/lib/utils";

export default function PetTraitsOwnerSection({
  petId,
  petName,
  orgName,
}: {
  petId: string;
  petName: string;
  orgName: string;
}) {
  const { data: traits, isLoading } = usePetTraits(petId);

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-xl font-semibold text-foreground">Traits & behavior</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These notes help {orgName || "the staff"} provide the best care for {petName}.
      </p>

      {isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading…</p>
      ) : !traits || traits.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No traits recorded yet.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {TRAIT_CATEGORY_ORDER.map((cat) => {
            const inCat = (traits ?? []).filter((t: any) => t.category === cat);
            if (!inCat.length) return null;
            return (
              <div key={cat}>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {categoryLabel(cat as TraitCategory)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {inCat.map((t: any) => (
                    <span
                      key={t.id}
                      title={t.notes ?? undefined}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[t.severity as TraitSeverity])} />
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
