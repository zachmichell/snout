import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import EmptyState from "@/components/portal/EmptyState";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/format";
import { logActivity } from "@/lib/activity";

type Owner = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  street_address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  notes: string | null;
  store_credit_cents: number;
};

type Pair = { a: Owner; b: Owner; reason: string };

function normEmail(e?: string | null) {
  return (e ?? "").trim().toLowerCase() || null;
}
function normPhone(p?: string | null) {
  return (p ?? "").replace(/\D/g, "") || null;
}

export default function DataMerge() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ keepId: string; mergeId: string } | null>(null);

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ["merge-owners", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, first_name, last_name, email, phone, created_at, street_address, city, state_province, postal_code, notes, store_credit_cents")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Owner[];
    },
  });

  const pairs: Pair[] = useMemo(() => {
    const byEmail = new Map<string, Owner[]>();
    const byPhone = new Map<string, Owner[]>();
    owners.forEach((o) => {
      const e = normEmail(o.email);
      const p = normPhone(o.phone);
      if (e) {
        const list = byEmail.get(e) ?? [];
        list.push(o); byEmail.set(e, list);
      }
      if (p) {
        const list = byPhone.get(p) ?? [];
        list.push(o); byPhone.set(p, list);
      }
    });
    const seen = new Set<string>();
    const result: Pair[] = [];
    const pushPairs = (group: Owner[], reason: string) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i], group[j]].sort((x, y) => x.created_at.localeCompare(y.created_at));
          const key = `${a.id}::${b.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ a, b, reason });
        }
      }
    };
    byEmail.forEach((g) => g.length > 1 && pushPairs(g, "Same email"));
    byPhone.forEach((g) => g.length > 1 && pushPairs(g, "Same phone"));
    return result;
  }, [owners]);

  const merge = useMutation({
    mutationFn: async ({ keepId, mergeId }: { keepId: string; mergeId: string }) => {
      if (!orgId) throw new Error("No org");
      const keep = owners.find((o) => o.id === keepId);
      const merge = owners.find((o) => o.id === mergeId);
      if (!keep || !merge) throw new Error("Owners not found");

      const mergedFields = {
        email: keep.email || merge.email,
        phone: keep.phone || merge.phone,
        street_address: keep.street_address || merge.street_address,
        city: keep.city || merge.city,
        state_province: keep.state_province || merge.state_province,
        postal_code: keep.postal_code || merge.postal_code,
        notes: [keep.notes, merge.notes].filter(Boolean).join("\n---\n") || null,
        store_credit_cents: (keep.store_credit_cents ?? 0) + (merge.store_credit_cents ?? 0),
      };

      await supabase.from("pet_owners").update({ owner_id: keepId }).eq("owner_id", mergeId);
      await supabase.from("reservations").update({ primary_owner_id: keepId }).eq("primary_owner_id", mergeId);
      await supabase.from("invoices").update({ owner_id: keepId }).eq("owner_id", mergeId);
      await supabase.from("emergency_contacts").update({ owner_id: keepId }).eq("owner_id", mergeId);
      await supabase.from("documents").update({ owner_id: keepId }).eq("owner_id", mergeId);
      await supabase.from("conversations").update({ owner_id: keepId }).eq("owner_id", mergeId);
      await supabase.from("owner_subscriptions").update({ owner_id: keepId }).eq("owner_id", mergeId);

      await supabase.from("owners").update(mergedFields).eq("id", keepId);
      await supabase.from("owners").update({ deleted_at: new Date().toISOString() }).eq("id", mergeId);

      await logActivity({
        organization_id: orgId,
        action: "merged",
        entity_type: "owner",
        entity_id: keepId,
        metadata: { kept: keepId, removed: mergeId, removed_name: `${merge.first_name} ${merge.last_name}` },
      });
    },
    onSuccess: () => {
      toast.success("Owners merged");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["merge-owners"] });
      qc.invalidateQueries({ queryKey: ["owners"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Merge failed"),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Merge Duplicates"
          description="Owner records that share an email or phone number. Pick which record to keep — the other is soft-deleted and all pets, reservations, and invoices move to the survivor."
        />
        {isLoading ? (
          <div className="rounded-lg border border-border bg-surface p-12 text-center text-sm text-text-secondary">Scanning…</div>
        ) : pairs.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6">
            <EmptyState icon={Users2} title="No duplicates found" description="Every owner has a unique email and phone number." />
          </div>
        ) : (
          <div className="space-y-4">
            {pairs.map(({ a, b, reason }) => (
              <div key={`${a.id}-${b.id}`} className="rounded-lg border border-border bg-surface shadow-card">
                <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
                  <span className="text-sm font-semibold text-foreground">{reason}</span>
                  <span className="text-xs text-text-secondary">Match value: {reason === "Same email" ? a.email : a.phone}</span>
                </div>
                <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
                  {[a, b].map((o) => (
                    <div key={o.id} className="rounded-md border border-border-subtle bg-background p-4">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="font-display text-base font-semibold text-foreground">{o.first_name} {o.last_name}</div>
                          <div className="text-xs text-text-secondary">Created {formatDate(o.created_at)}</div>
                        </div>
                        <Button
                          size="sm"
                          variant={selected?.keepId === o.id ? "default" : "outline"}
                          onClick={() => setSelected({ keepId: o.id, mergeId: o.id === a.id ? b.id : a.id })}
                        >
                          Keep this one
                        </Button>
                      </div>
                      <dl className="space-y-1 text-xs">
                        <Row label="Email" value={o.email} />
                        <Row label="Phone" value={o.phone} />
                        <Row label="Address" value={[o.street_address, o.city, o.state_province, o.postal_code].filter(Boolean).join(", ") || null} />
                        <Row label="Notes" value={o.notes} />
                        <Row label="Store credit" value={`$${((o.store_credit_cents ?? 0) / 100).toFixed(2)}`} />
                      </dl>
                    </div>
                  ))}
                </div>
                {selected && (selected.keepId === a.id || selected.keepId === b.id) && (selected.mergeId === a.id || selected.mergeId === b.id) && (
                  <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-3">
                    <span className="text-xs text-text-secondary">
                      Will keep <strong>{owners.find((o) => o.id === selected.keepId)?.first_name}</strong>{" "}
                      <ArrowRight className="inline h-3 w-3" /> remove duplicate
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Cancel</Button>
                    <Button
                      size="sm"
                      disabled={merge.isPending}
                      onClick={() => merge.mutate(selected)}
                    >
                      {merge.isPending ? "Merging…" : "Confirm merge"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-text-tertiary">{label}</dt>
      <dd className="text-text-secondary">{value || "—"}</dd>
    </div>
  );
}
