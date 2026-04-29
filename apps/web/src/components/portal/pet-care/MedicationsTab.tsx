import { useState } from "react";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { usePetMedications } from "@/hooks/usePetMedications";
import MedicationFormDialog from "./MedicationFormDialog";

export default function MedicationsTab({ petId }: { petId: string }) {
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const { data: meds } = usePetMedications(petId, showInactive);
  const qc = useQueryClient();

  const toggle = async (m: any) => {
    const { error } = await supabase
      .from("pet_medications")
      .update({ is_active: !m.is_active })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success(m.is_active ? "Medication archived" : "Medication restored");
    qc.invalidateQueries({ queryKey: ["pet-medications", petId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(!!v)} />
          Show archived
        </label>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Medication
        </Button>
      </div>

      {!meds || meds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          No medications recorded.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {meds.map((m: any) => (
            <div
              key={m.id}
              className={`rounded-lg border bg-surface p-4 shadow-card ${
                m.is_active ? "border-border" : "border-border-subtle opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-display text-base text-foreground">{m.name}</h3>
                    {m.dosage && <span className="text-sm text-text-secondary">· {m.dosage}</span>}
                  </div>
                  {(m.frequency || m.timing) && (
                    <p className="mt-1 text-sm text-text-secondary">
                      {[m.frequency, m.timing].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {m.instructions && (
                    <p className="mt-2 text-xs text-text-tertiary whitespace-pre-wrap">{m.instructions}</p>
                  )}
                  {!m.is_active && (
                    <span className="mt-2 inline-block rounded-pill bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                      Archived
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(m); setOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle(m)}>
                    {m.is_active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <MedicationFormDialog open={open} onOpenChange={setOpen} petId={petId} existing={editing} />
    </div>
  );
}
