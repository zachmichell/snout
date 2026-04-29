import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Mail, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import StatusBadge from "@/components/portal/StatusBadge";
import { toast } from "sonner";

type OwnerRow = {
  id: string;
  role: "primary" | "co-owner" | string;
  owner: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    deleted_at: string | null;
  } | null;
};

export default function PetOwnersSection({ petId, canEdit = true }: { petId: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["pet-owners-roles", petId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("id, role, relationship, created_at, owner:owners(id, first_name, last_name, email, phone, deleted_at)")
        .eq("pet_id", petId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => r.owner && !r.owner.deleted_at) as OwnerRow[];
    },
  });

  const primaryCount = (rows ?? []).filter((r) => r.role === "primary").length;

  const removeLink = async (linkId: string, role: string) => {
    if (role === "primary" && primaryCount <= 1) {
      toast.error("Can't remove the primary owner. Promote a co-owner first.");
      return;
    }
    const { error } = await supabase.from("pet_owners").delete().eq("id", linkId);
    if (error) return toast.error(error.message);
    toast.success("Owner unlinked");
    qc.invalidateQueries({ queryKey: ["pet-owners-roles", petId] });
    qc.invalidateQueries({ queryKey: ["pet-owners", petId] });
  };

  const promoteToPrimary = async (linkId: string) => {
    // Demote current primaries to co-owner, promote this one
    const { error: e1 } = await supabase
      .from("pet_owners")
      .update({ role: "co-owner" })
      .eq("pet_id", petId)
      .eq("role", "primary");
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase.from("pet_owners").update({ role: "primary" }).eq("id", linkId);
    if (e2) return toast.error(e2.message);
    toast.success("Primary owner updated");
    qc.invalidateQueries({ queryKey: ["pet-owners-roles", petId] });
  };

  const addOwner = async (ownerId: string) => {
    if (!membership) return;
    // If no primary exists yet, the new one becomes primary; otherwise co-owner
    const role = (rows ?? []).length === 0 ? "primary" : "co-owner";
    const { error } = await supabase.from("pet_owners").insert({
      pet_id: petId,
      owner_id: ownerId,
      organization_id: membership.organization_id,
      role,
      relationship: role === "primary" ? "primary" : "secondary",
    } as any);
    if (error) return toast.error(error.message);
    toast.success(role === "primary" ? "Primary owner linked" : "Co-owner linked");
    setPickerOpen(false);
    qc.invalidateQueries({ queryKey: ["pet-owners-roles", petId] });
    qc.invalidateQueries({ queryKey: ["pet-owners", petId] });
  };

  return (
    <div className="rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border-subtle p-4">
        <div className="font-display text-base">Owners</div>
        {canEdit && (
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" /> Add Owner
          </Button>
        )}
      </div>

      {!rows || rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-secondary">No owners linked yet.</div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const isPrimary = row.role === "primary";
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/owners/${row.owner!.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {row.owner!.first_name} {row.owner!.last_name}
                    </Link>
                    <StatusBadge tone={isPrimary ? "primary" : "muted"}>
                      {isPrimary ? "Primary" : "Co-owner"}
                    </StatusBadge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                    {row.owner!.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {row.owner!.email}
                      </span>
                    )}
                    {row.owner!.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {row.owner!.phone}
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {!isPrimary && (
                      <button
                        onClick={() => promoteToPrimary(row.id)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Make Primary
                      </button>
                    )}
                    <button
                      onClick={() => removeLink(row.id, row.role)}
                      disabled={isPrimary && primaryCount <= 1}
                      className="rounded-md p-1.5 text-text-tertiary hover:bg-background hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                      title={isPrimary && primaryCount <= 1 ? "Can't remove the only primary owner" : "Unlink"}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <OwnerPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludeIds={(rows ?? []).map((r) => r.owner!.id)}
        onPick={addOwner}
      />
    </div>
  );
}

function OwnerPickerDialog({
  open,
  onOpenChange,
  excludeIds,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  excludeIds: string[];
  onPick: (ownerId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      let q = supabase
        .from("owners")
        .select("id, first_name, last_name, email, phone")
        .is("deleted_at", null)
        .limit(25);
      const term = search.trim();
      if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`);
      const { data } = await q;
      if (cancelled) return;
      setResults((data ?? []).filter((o) => !exclude.has(o.id)));
      setLoading(false);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, search, exclude]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-display">Add Owner</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-background"
          />
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {loading && <div className="p-4 text-sm text-text-secondary">Loading…</div>}
            {!loading && results.length === 0 && (
              <div className="p-4 text-sm text-text-secondary">No matches.</div>
            )}
            {!loading &&
              results.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => onPick(o.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-background"
                >
                  <div>
                    <div className="font-medium text-foreground">
                      {o.first_name} {o.last_name}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {o.email ?? ""}
                      {o.email && o.phone ? " · " : ""}
                      {o.phone ?? ""}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-primary">Add</span>
                </button>
              ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
