import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Merge,
  X,
  Mail,
  Phone,
  Users,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import {
  findOwnerDuplicates,
  findPetDuplicates,
  dupePairKey,
  type Confidence,
  type DuplicateGroup,
  type OwnerRecord,
  type PetRecord,
} from "@/lib/duplicates";

type Mode = "owner" | "pet";

const confidenceTone: Record<Confidence, string> = {
  high: "bg-status-success-bg text-status-success border-status-success/30",
  medium: "bg-status-warning-bg text-status-warning border-status-warning/30",
  low: "bg-status-teal-bg text-status-teal border-status-teal/30",
};

export default function DuplicateReviewDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: Mode;
}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, label: "" });
  const [bulkSummary, setBulkSummary] = useState<{ groups: number; consolidated: number; primaries: number } | null>(null);
  const [autoMergeOpen, setAutoMergeOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["duplicates", mode, orgId],
    enabled: open && !!orgId,
    queryFn: async () => {
      const { data: dismissed } = await supabase
        .from("dismissed_duplicates")
        .select("record_id_1, record_id_2")
        .eq("organization_id", orgId!)
        .eq("entity_type", mode);
      const dismissedSet = new Set(
        (dismissed ?? []).map((r: any) => dupePairKey(r.record_id_1, r.record_id_2)),
      );

      if (mode === "owner") {
        const owners = await fetchAllOwners(orgId!);
        const groups = findOwnerDuplicates(owners, dismissedSet);
        return { groups: groups as DuplicateGroup<any>[] };
      } else {
        const pets = await fetchAllPets(orgId!);
        const groups = findPetDuplicates(pets, dismissedSet);
        return { groups: groups as DuplicateGroup<any>[] };
      }
    },
  });

  const groups = data?.groups ?? [];
  const summary = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const g of groups) c[g.confidence]++;
    return c;
  }, [groups]);

  // Reset selection when groups change (after refetch)
  useEffect(() => {
    setSelected(new Set());
    setBulkSummary(null);
  }, [data]);

  const toggle = (k: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const toggleSelect = (k: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  const allSelected = groups.length > 0 && groups.every((g) => selected.has(g.key));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.key)));
  };

  function pickPrimary(group: DuplicateGroup<any>) {
    const sorted = [...group.records].sort((a: any, b: any) => {
      const score = (r: any) =>
        mode === "owner"
          ? (r.pet_count ?? 0) + (r.reservation_count ?? 0)
          : (r.owner_ids?.length ?? 0);
      const sb = score(b) - score(a);
      if (sb !== 0) return sb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return sorted[0];
  }

  async function dismissSingle(group: DuplicateGroup<any>) {
    const ids = group.records.map((r) => r.id);
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        rows.push({
          organization_id: orgId,
          entity_type: mode,
          record_id_1: ids[i],
          record_id_2: ids[j],
        });
      }
    }
    const { error } = await supabase.from("dismissed_duplicates").insert(rows);
    if (error) throw error;
  }

  async function handleSingleDismiss(group: DuplicateGroup<any>) {
    try {
      await dismissSingle(group);
      toast.success("Marked as not duplicates");
      qc.invalidateQueries({ queryKey: ["duplicates", mode, orgId] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to dismiss");
    }
  }

  async function handleSingleMerge(group: DuplicateGroup<any>, primary: any) {
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: 1, label: "Merging…" });
    try {
      const duplicates = group.records.filter((r: any) => r.id !== primary.id);
      await mergeGroup(mode, primary, duplicates);
      toast.success("Records merged");
      qc.invalidateQueries({ queryKey: ["duplicates", mode, orgId] });
      qc.invalidateQueries({ queryKey: [mode === "owner" ? "owners" : "pets"] });
    } catch (e: any) {
      toast.error(e.message ?? "Merge failed");
    } finally {
      setBulkRunning(false);
    }
  }

  async function runBulkMerge(targetGroups: DuplicateGroup<any>[]) {
    if (targetGroups.length === 0) return;
    setBulkRunning(true);
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: targetGroups.length, label: `Merging group 1 of ${targetGroups.length}…` });
    let merged = 0;
    let consolidated = 0;
    for (let i = 0; i < targetGroups.length; i++) {
      const g = targetGroups[i];
      setBulkProgress({ done: i, total: targetGroups.length, label: `Merging group ${i + 1} of ${targetGroups.length}…` });
      try {
        const primary = pickPrimary(g);
        const duplicates = g.records.filter((r: any) => r.id !== primary.id);
        await mergeGroup(mode, primary, duplicates);
        merged++;
        consolidated += duplicates.length;
      } catch (e: any) {
        toast.error(`Group ${i + 1} failed: ${e.message ?? e}`);
      }
    }
    setBulkProgress({ done: targetGroups.length, total: targetGroups.length, label: "Done" });
    setBulkSummary({ groups: merged, consolidated, primaries: merged });
    setBulkRunning(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["duplicates", mode, orgId] });
    qc.invalidateQueries({ queryKey: [mode === "owner" ? "owners" : "pets"] });
  }

  async function runBulkDismiss(targetGroups: DuplicateGroup<any>[]) {
    if (targetGroups.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: targetGroups.length, label: `Dismissing 1 of ${targetGroups.length}…` });
    for (let i = 0; i < targetGroups.length; i++) {
      setBulkProgress({ done: i, total: targetGroups.length, label: `Dismissing ${i + 1} of ${targetGroups.length}…` });
      try {
        await dismissSingle(targetGroups[i]);
      } catch (e: any) {
        toast.error(`Dismiss failed: ${e.message ?? e}`);
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
    toast.success(`Dismissed ${targetGroups.length} group${targetGroups.length === 1 ? "" : "s"}`);
    qc.invalidateQueries({ queryKey: ["duplicates", mode, orgId] });
  }

  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const highGroups = groups.filter((g) => g.confidence === "high");

  const title = mode === "owner" ? "Find Duplicate Owners" : "Find Duplicate Pets";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display">{title}</DialogTitle>
            <DialogDescription>
              Review records that look similar. Pick a primary record to merge into, or mark a group as
              not a duplicate.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-secondary">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Scanning {mode === "owner" ? "owners" : "pets"}…</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                <Search className="h-4 w-4 text-text-tertiary" />
                <span className="text-sm text-foreground">
                  Found <strong>{groups.length}</strong> potential duplicate group
                  {groups.length === 1 ? "" : "s"}
                </span>
                <span className="text-text-tertiary">·</span>
                <Badge className={confidenceTone.high}>{summary.high} high</Badge>
                <Badge className={confidenceTone.medium}>{summary.medium} medium</Badge>
                <Badge className={confidenceTone.low}>{summary.low} low</Badge>
                {highGroups.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={bulkRunning}
                    onClick={() => setAutoMergeOpen(true)}
                  >
                    <Sparkles className="h-4 w-4" /> Auto-merge all high-confidence
                  </Button>
                )}
              </div>

              {bulkRunning && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-2">
                    <span>{bulkProgress.label}</span>
                    <span className="font-mono">
                      {bulkProgress.done} / {bulkProgress.total}
                    </span>
                  </div>
                  <Progress
                    value={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
                  />
                </div>
              )}

              {bulkSummary && !bulkRunning && (
                <div className="rounded-lg border-l-4 border-l-success bg-success/5 px-4 py-3 text-sm">
                  Merged <strong>{bulkSummary.groups}</strong> group{bulkSummary.groups === 1 ? "" : "s"} ·{" "}
                  <strong>{bulkSummary.consolidated}</strong> records consolidated into{" "}
                  <strong>{bulkSummary.primaries}</strong> primary record{bulkSummary.primaries === 1 ? "" : "s"}.
                </div>
              )}

              {groups.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 px-1">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                    Select all ({groups.length})
                  </label>
                  <span className="text-xs text-text-tertiary">{selected.size} selected</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selected.size === 0 || bulkRunning}
                      onClick={() => runBulkDismiss(selectedGroups)}
                    >
                      <X className="h-4 w-4" /> Dismiss Selected
                    </Button>
                    <Button
                      size="sm"
                      disabled={selected.size === 0 || bulkRunning}
                      onClick={() => runBulkMerge(selectedGroups)}
                    >
                      <Merge className="h-4 w-4" /> Merge Selected
                    </Button>
                  </div>
                </div>
              )}

              <ScrollArea className="flex-1 -mx-6 px-6">
                {groups.length === 0 ? (
                  <div className="py-16 text-center text-sm text-text-secondary">
                    No duplicate {mode === "owner" ? "owners" : "pets"} found. ✨
                  </div>
                ) : (
                  <div className="space-y-3 py-2">
                    {groups.map((g) => (
                      <GroupCard
                        key={g.key}
                        group={g}
                        mode={mode}
                        expanded={expanded.has(g.key)}
                        selected={selected.has(g.key)}
                        onToggleSelect={() => toggleSelect(g.key)}
                        onToggle={() => toggle(g.key)}
                        onDismiss={() => handleSingleDismiss(g)}
                        onMerge={(primary) => handleSingleMerge(g, primary)}
                        disabled={bulkRunning}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={autoMergeOpen} onOpenChange={setAutoMergeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auto-merge {highGroups.length} high-confidence duplicate group{highGroups.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will keep the record with more history (most pets/reservations) and reassign all
              relationships from the duplicates. Soft-deleted records can be reviewed later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => runBulkMerge(highGroups)}>
              Auto-merge {highGroups.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GroupCard({
  group,
  mode,
  expanded,
  selected,
  onToggleSelect,
  onToggle,
  onDismiss,
  onMerge,
  disabled,
}: {
  group: DuplicateGroup<any>;
  mode: Mode;
  expanded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onToggle: () => void;
  onDismiss: () => void;
  onMerge: (primary: any) => void;
  disabled: boolean;
}) {
  const primary = useMemo(() => {
    const sorted = [...group.records].sort((a: any, b: any) => {
      const score = (r: any) =>
        mode === "owner"
          ? (r.pet_count ?? 0) + (r.reservation_count ?? 0)
          : (r.owner_ids?.length ?? 0);
      const sb = score(b) - score(a);
      if (sb !== 0) return sb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return sorted[0];
  }, [group, mode]);

  const [chosen, setChosen] = useState<string>(primary.id);

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-tertiary" />
          )}
          <Badge className={confidenceTone[group.confidence]}>{group.confidence}</Badge>
          <span className="text-sm font-medium text-foreground">{group.reason}</span>
          <span className="text-xs text-text-tertiary">{group.records.length} records</span>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border-subtle p-4">
          <div className="grid gap-3 md:grid-cols-2">
            {group.records.map((r: any) => (
              <RecordCard
                key={r.id}
                record={r}
                mode={mode}
                isPrimary={chosen === r.id}
                onPick={() => setChosen(r.id)}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onDismiss} disabled={disabled}>
              <X className="h-4 w-4" /> Not a duplicate
            </Button>
            <Button
              size="sm"
              onClick={() => onMerge(group.records.find((r: any) => r.id === chosen))}
              disabled={disabled}
            >
              <Merge className="h-4 w-4" /> Merge into selected
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordCard({
  record,
  mode,
  isPrimary,
  onPick,
}: {
  record: any;
  mode: Mode;
  isPrimary: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        isPrimary
          ? "border-primary bg-primary-light"
          : "border-border bg-card-alt hover:border-primary/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {mode === "owner" ? (
            <>
              <div className="font-medium text-foreground truncate">
                {record.first_name} {record.last_name}
              </div>
              {record.email && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary truncate">
                  <Mail className="h-3 w-3" /> {record.email}
                </div>
              )}
              {record.phone && (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary">
                  <Phone className="h-3 w-3" /> {record.phone}
                </div>
              )}
              {(record.street_address || record.city) && (
                <div className="mt-0.5 text-xs text-text-tertiary truncate">
                  {[record.street_address, record.city].filter(Boolean).join(", ")}
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs text-text-secondary">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> {record.pet_count ?? 0} pets
                </span>
                <span>{record.reservation_count ?? 0} reservations</span>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium text-foreground truncate">{record.name}</div>
              <div className="mt-1 text-xs text-text-secondary capitalize">
                {record.breed ?? "—"} · {record.species ?? "—"}
              </div>
              {record.owner_names?.length > 0 && (
                <div className="mt-0.5 text-xs text-text-tertiary truncate">
                  Owner: {record.owner_names.join(", ")}
                </div>
              )}
              {record.date_of_birth && (
                <div className="mt-0.5 text-xs text-text-tertiary">
                  DOB: {formatDate(record.date_of_birth)}
                </div>
              )}
            </>
          )}
          <div className="mt-2 text-xs text-text-tertiary">
            Created {formatDate(record.created_at)}
          </div>
        </div>
        {isPrimary && <Badge className="bg-primary text-primary-foreground">Primary</Badge>}
      </div>
    </button>
  );
}

// ---------- Merge implementation ----------

async function mergeGroup(mode: Mode, primary: any, duplicates: any[]) {
  const dupIds = duplicates.map((d) => d.id);
  if (dupIds.length === 0) return;

  if (mode === "owner") {
    const { data: pos } = await supabase
      .from("pet_owners")
      .select("id, pet_id, owner_id")
      .in("owner_id", dupIds);
    const { data: existing } = await supabase
      .from("pet_owners")
      .select("pet_id")
      .eq("owner_id", primary.id);
    const existingPets = new Set((existing ?? []).map((r: any) => r.pet_id));
    for (const po of pos ?? []) {
      if (existingPets.has(po.pet_id)) {
        await supabase.from("pet_owners").delete().eq("id", po.id);
      } else {
        await supabase.from("pet_owners").update({ owner_id: primary.id }).eq("id", po.id);
        existingPets.add(po.pet_id);
      }
    }
    await supabase
      .from("reservations")
      .update({ primary_owner_id: primary.id })
      .in("primary_owner_id", dupIds);
    await supabase.from("invoices").update({ owner_id: primary.id }).in("owner_id", dupIds);
    const { error } = await supabase
      .from("owners")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", dupIds);
    if (error) throw error;
  } else {
    const { data: existing } = await supabase
      .from("pet_owners")
      .select("owner_id")
      .eq("pet_id", primary.id);
    const existingOwners = new Set((existing ?? []).map((r: any) => r.owner_id));
    const { data: dupPos } = await supabase
      .from("pet_owners")
      .select("id, owner_id")
      .in("pet_id", dupIds);
    for (const po of dupPos ?? []) {
      if (existingOwners.has(po.owner_id)) {
        await supabase.from("pet_owners").delete().eq("id", po.id);
      } else {
        await supabase.from("pet_owners").update({ pet_id: primary.id }).eq("id", po.id);
        existingOwners.add(po.owner_id);
      }
    }
    await supabase.from("vaccinations").update({ pet_id: primary.id }).in("pet_id", dupIds);
    await supabase.from("reservation_pets").update({ pet_id: primary.id }).in("pet_id", dupIds);
    const { error } = await supabase
      .from("pets")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", dupIds);
    if (error) throw error;
  }
}

// ---------- Data fetching ----------

async function fetchAllOwners(orgId: string): Promise<OwnerRecord[]> {
  const PAGE = 1000;
  let from = 0;
  const all: OwnerRecord[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("owners")
      .select(
        "id, first_name, last_name, email, phone, street_address, city, created_at, pet_owners(id), reservations:reservations!reservations_primary_owner_id_fkey(id)",
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const o of data as any[]) {
      all.push({
        id: o.id,
        first_name: o.first_name,
        last_name: o.last_name,
        email: o.email,
        phone: o.phone,
        street_address: o.street_address,
        city: o.city,
        created_at: o.created_at,
        pet_count: o.pet_owners?.length ?? 0,
        reservation_count: o.reservations?.length ?? 0,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchAllPets(orgId: string): Promise<PetRecord[]> {
  const PAGE = 1000;
  let from = 0;
  const all: PetRecord[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("pets")
      .select(
        "id, name, species, breed, date_of_birth, created_at, pet_owners(owner:owners(id, first_name, last_name))",
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const p of data as any[]) {
      const owners = (p.pet_owners ?? []).map((po: any) => po.owner).filter(Boolean);
      all.push({
        id: p.id,
        name: p.name,
        species: p.species,
        breed: p.breed,
        date_of_birth: p.date_of_birth,
        created_at: p.created_at,
        owner_ids: owners.map((o: any) => o.id),
        owner_names: owners.map((o: any) => `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim()),
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
