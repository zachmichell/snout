import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { usePetTraits } from "@/hooks/usePetTraits";
import {
  TRAIT_CATEGORY_ORDER,
  categoryLabel,
  SEVERITY_CHIP,
  SEVERITY_DOT,
  type TraitCategory,
  type TraitSeverity,
} from "@/lib/traits";
import { cn } from "@/lib/utils";
import TraitFormDialog from "./TraitFormDialog";

type Trait = {
  id: string;
  pet_id: string;
  category: TraitCategory;
  label: string;
  severity: TraitSeverity;
  notes: string | null;
};

export default function TraitsTab({ petId }: { petId: string }) {
  const qc = useQueryClient();
  const { data: traits } = usePetTraits(petId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trait | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const grouped = (traits ?? []).reduce<Record<string, Trait[]>>((acc, t) => {
    (acc[t.category] ||= []).push(t as Trait);
    return acc;
  }, {});

  const remove = async (id: string) => {
    const { error } = await supabase.from("pet_traits").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Trait removed");
    qc.invalidateQueries({ queryKey: ["pet-traits", petId] });
    setRemoveId(null);
  };

  // Warnings shown prominently first.
  const warnings = (traits ?? []).filter((t: any) => t.severity === "warning") as Trait[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Persistent behavior notes — they describe the pet, not a specific visit.
        </p>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Trait
        </Button>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive-light p-4">
          <div className="label-eyebrow text-destructive mb-2">Active management required</div>
          <div className="flex flex-wrap gap-1.5">
            {warnings.map((t) => (
              <TraitPill key={`warn-${t.id}`} trait={t} onEdit={() => { setEditing(t); setOpen(true); }} onRemove={() => setRemoveId(t.id)} />
            ))}
          </div>
        </div>
      )}

      {(!traits || traits.length === 0) && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          No traits recorded yet. Add traits to help staff care for this pet safely.
        </div>
      )}

      {TRAIT_CATEGORY_ORDER.map((cat) => {
        const list = grouped[cat];
        if (!list || list.length === 0) return null;
        return (
          <div key={cat} className="rounded-lg border border-border bg-surface p-5 shadow-card">
            <div className="font-display text-base mb-3">{categoryLabel(cat)}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((t) => (
                <TraitPill key={t.id} trait={t} onEdit={() => { setEditing(t); setOpen(true); }} onRemove={() => setRemoveId(t.id)} />
              ))}
            </div>
          </div>
        );
      })}

      <TraitFormDialog open={open} onOpenChange={setOpen} petId={petId} existing={editing} />

      <AlertDialog open={!!removeId} onOpenChange={(o) => !o && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove trait?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the trait permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeId && remove(removeId)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TraitPill({
  trait,
  onEdit,
  onRemove,
}: {
  trait: Trait;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-xs font-medium",
        SEVERITY_CHIP[trait.severity],
      )}
      title={trait.notes ?? undefined}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[trait.severity])} />
      <span>{trait.label}</span>
      <button
        type="button"
        onClick={onEdit}
        className="opacity-60 hover:opacity-100"
        aria-label="Edit trait"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-60 hover:opacity-100"
        aria-label="Remove trait"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
