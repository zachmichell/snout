import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import {
  TRAIT_CATEGORIES,
  TRAIT_CATEGORY_ORDER,
  TRAIT_SUGGESTIONS,
  SEVERITY_CHIP,
  SEVERITY_DOT,
  categoryLabel,
  type TraitCategory,
  type TraitSeverity,
} from "@/lib/traits";
import { cn } from "@/lib/utils";

type TraitRow = {
  id: string;
  pet_id: string;
  category: TraitCategory;
  label: string;
  severity: TraitSeverity;
};

export default function SettingsTraitsTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: traits, isLoading } = useQuery({
    enabled: !!orgId,
    queryKey: ["org-traits", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_traits")
        .select("id, pet_id, category, label, severity")
        .eq("organization_id", orgId!)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as TraitRow[];
    },
  });

  const stats = useMemo(() => {
    const list = traits ?? [];
    const total = list.length;
    const distinctPets = new Set(list.map((t) => t.pet_id)).size;
    const bySeverity = { info: 0, caution: 0, warning: 0 } as Record<TraitSeverity, number>;
    const byCategory = {} as Record<TraitCategory, number>;
    const labelCounts = new Map<string, { label: string; category: TraitCategory; count: number }>();
    for (const t of list) {
      bySeverity[t.severity] = (bySeverity[t.severity] ?? 0) + 1;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
      const key = `${t.category}::${t.label.toLowerCase()}`;
      const existing = labelCounts.get(key);
      if (existing) existing.count += 1;
      else labelCounts.set(key, { label: t.label, category: t.category, count: 1 });
    }
    const topLabels = Array.from(labelCounts.values()).sort((a, b) => b.count - a.count).slice(0, 12);
    return { total, distinctPets, bySeverity, byCategory, topLabels };
  }, [traits]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1">
            <h3 className="font-display text-base text-foreground">Pet traits</h3>
            <p className="text-sm text-text-secondary">
              Traits live on each pet's profile under the <span className="font-medium text-foreground">Traits</span> tab.
              They describe persistent behavior and follow the pet across visits. Use this page to monitor what your team
              is recording across the org.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="p-4">
          <div className="label-eyebrow">Total traits</div>
          <div className="mt-1 font-display text-2xl text-foreground">{isLoading ? "…" : stats.total}</div>
          <div className="mt-1 text-xs text-text-secondary">across {stats.distinctPets} pets</div>
        </Card>
        <SeverityCard label="Info" count={stats.bySeverity.info} severity="info" Icon={Info} />
        <SeverityCard label="Caution" count={stats.bySeverity.caution} severity="caution" Icon={AlertTriangle} />
        <SeverityCard label="Warning" count={stats.bySeverity.warning} severity="warning" Icon={ShieldAlert} />
      </div>

      {/* Most common labels */}
      <Card className="p-5">
        <div className="mb-3">
          <h3 className="font-display text-base text-foreground">Most common traits</h3>
          <div className="text-xs text-text-secondary">Tags your team has assigned across the organization.</div>
        </div>
        {stats.topLabels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-secondary">
            No traits recorded yet. Open any pet profile and use the Traits tab to add one.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {stats.topLabels.map((t) => (
              <span
                key={`${t.category}-${t.label}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs"
              >
                <span className="font-medium text-foreground">{t.label}</span>
                <span className="text-text-tertiary">· {categoryLabel(t.category)}</span>
                <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-foreground">
                  {t.count}
                </span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Reference: categories + suggestions */}
      <Card className="p-5">
        <div className="mb-3">
          <h3 className="font-display text-base text-foreground">Categories &amp; suggestions</h3>
          <div className="text-xs text-text-secondary">
            Each new trait is filed under one of these categories. Suggested labels appear in the quick-add picker.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {TRAIT_CATEGORY_ORDER.map((cat) => {
            const meta = TRAIT_CATEGORIES.find((c) => c.value === cat);
            const used = stats.byCategory[cat] ?? 0;
            const suggestions = TRAIT_SUGGESTIONS[cat] ?? [];
            return (
              <div key={cat} className="rounded-lg border border-border-subtle bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-sm text-foreground">{meta?.label ?? cat}</div>
                    <div className="text-xs text-text-tertiary">{meta?.description}</div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                    {used} in use
                  </span>
                </div>
                {suggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-text-secondary"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function SeverityCard({
  label,
  count,
  severity,
  Icon,
}: {
  label: string;
  count: number;
  severity: TraitSeverity;
  Icon: typeof Info;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full border", SEVERITY_CHIP[severity])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="label-eyebrow">{label}</div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[severity])} />
        <div className="font-display text-2xl text-foreground">{count}</div>
      </div>
    </Card>
  );
}
