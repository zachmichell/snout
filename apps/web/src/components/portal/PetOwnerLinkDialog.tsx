import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Relationship = Database["public"]["Enums"]["pet_owner_relationship"];

type Mode = "owner-to-pet" | "pet-to-owner";

export default function PetOwnerLinkDialog({
  open,
  onOpenChange,
  mode,
  ownerId,
  petId,
  contextName,
  excludeIds,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: Mode;
  ownerId?: string;
  petId?: string;
  contextName?: string;
  excludeIds?: string[];
  onLinked?: () => void;
}) {
  const { membership } = useAuth();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; label: string; sub?: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<Relationship>("primary");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const titleSubject = mode === "owner-to-pet" ? "Pet" : "Owner";
  const targetSubject = mode === "owner-to-pet" ? `to ${contextName ?? "Owner"}` : `to ${contextName ?? "Pet"}`;

  const excludeSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults([]);
      setSelectedId(null);
      setRelationship("primary");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !membership) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      if (mode === "owner-to-pet") {
        let q = supabase.from("pets").select("id, name, breed, species").is("deleted_at", null).limit(20);
        if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
        const { data } = await q;
        if (cancelled) return;
        setResults(
          (data ?? [])
            .filter((p) => !excludeSet.has(p.id))
            .map((p) => ({ id: p.id, label: p.name, sub: [p.species, p.breed].filter(Boolean).join(" • ") })),
        );
      } else {
        let q = supabase.from("owners").select("id, first_name, last_name, email").is("deleted_at", null).limit(20);
        const term = search.trim();
        if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
        const { data } = await q;
        if (cancelled) return;
        setResults(
          (data ?? [])
            .filter((o) => !excludeSet.has(o.id))
            .map((o) => ({ id: o.id, label: `${o.first_name} ${o.last_name}`, sub: o.email ?? undefined })),
        );
      }
      setLoading(false);
    };
    const t = setTimeout(run, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, mode, search, membership, excludeSet]);

  const handleLink = async () => {
    if (!selectedId || !membership) return;
    setSaving(true);
    const role = relationship === "primary" ? "primary" : "co-owner";
    const payload = {
      organization_id: membership.organization_id,
      owner_id: mode === "owner-to-pet" ? ownerId! : selectedId,
      pet_id: mode === "owner-to-pet" ? selectedId : petId!,
      relationship,
      role,
    };
    const { error } = await supabase.from("pet_owners").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${titleSubject} linked`);
    onOpenChange(false);
    onLinked?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-display">
            Link {titleSubject} {targetSubject}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="label-eyebrow">Search</label>
            <Input
              autoFocus
              placeholder={mode === "owner-to-pet" ? "Search pets by name…" : "Search owners by name or email…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1.5 bg-background"
            />
          </div>

          <div className="max-h-60 overflow-y-auto rounded-md border border-border">
            {loading && <div className="p-4 text-sm text-text-secondary">Loading…</div>}
            {!loading && results.length === 0 && (
              <div className="p-4 text-sm text-text-secondary">No matches.</div>
            )}
            {!loading &&
              results.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-background ${
                    selectedId === r.id ? "bg-primary-light" : ""
                  }`}
                >
                  <div>
                    <div className="font-medium text-foreground">{r.label}</div>
                    {r.sub && <div className="text-xs text-text-secondary">{r.sub}</div>}
                  </div>
                  {selectedId === r.id && <span className="text-xs font-semibold text-primary">Selected</span>}
                </button>
              ))}
          </div>

          <div>
            <label className="label-eyebrow">Relationship</label>
            <Select value={relationship} onValueChange={(v) => setRelationship(v as Relationship)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
                <SelectItem value="emergency_only">Emergency Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!selectedId || saving}>
            {saving ? "Linking…" : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
