import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TRAIT_CATEGORIES,
  TRAIT_SUGGESTIONS,
  SEVERITY_OPTIONS,
  SEVERITY_DOT,
  type TraitCategory,
  type TraitSeverity,
} from "@/lib/traits";
import { cn } from "@/lib/utils";

type Trait = {
  id: string;
  pet_id: string;
  category: TraitCategory;
  label: string;
  severity: TraitSeverity;
  notes: string | null;
};

export default function TraitFormDialog({
  open,
  onOpenChange,
  petId,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  petId: string;
  existing?: Trait | null;
}) {
  const { user, membership } = useAuth();
  const qc = useQueryClient();
  const [category, setCategory] = useState<TraitCategory>("temperament");
  const [label, setLabel] = useState("");
  const [severity, setSeverity] = useState<TraitSeverity>("info");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory((existing?.category as TraitCategory) ?? "temperament");
      setLabel(existing?.label ?? "");
      setSeverity((existing?.severity as TraitSeverity) ?? "info");
      setNotes(existing?.notes ?? "");
    }
  }, [open, existing]);

  const save = async () => {
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (!membership?.organization_id) return;
    setSaving(true);
    try {
      if (existing) {
        const { error } = await supabase
          .from("pet_traits")
          .update({
            category,
            label: label.trim(),
            severity,
            notes: notes.trim() || null,
          })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Trait updated");
      } else {
        const { error } = await supabase.from("pet_traits").insert({
          organization_id: membership.organization_id,
          pet_id: petId,
          category,
          label: label.trim(),
          severity,
          notes: notes.trim() || null,
          added_by: user?.id ?? null,
        });
        if (error) throw error;
        toast.success("Trait added");
      }
      qc.invalidateQueries({ queryKey: ["pet-traits", petId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Could not save trait");
    } finally {
      setSaving(false);
    }
  };

  const suggestions = TRAIT_SUGGESTIONS[category] ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit trait" : "Add trait"}</DialogTitle>
          <DialogDescription>
            Persistent behavior notes that follow the pet across visits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TraitCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAIT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {suggestions.length > 0 && !existing && (
            <div className="space-y-1.5">
              <Label className="text-xs text-text-tertiary">Quick suggestions</Label>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setLabel(s)}
                    className="rounded-pill border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-primary-light hover:border-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="trait-label">Label</Label>
            <Input
              id="trait-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Reactive to large dogs"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Severity</Label>
            <div className="flex gap-2">
              {SEVERITY_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1 rounded-md border p-3 text-xs transition-all",
                    severity === s.value
                      ? "border-primary bg-primary-light"
                      : "border-border bg-background hover:border-primary/40",
                  )}
                >
                  <span className={cn("h-3 w-3 rounded-full", SEVERITY_DOT[s.value])} />
                  <span className="font-semibold text-foreground">{s.label}</span>
                  <span className="text-text-tertiary">{s.help}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trait-notes">Notes (optional)</Label>
            <Textarea
              id="trait-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Additional context"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Add trait"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
