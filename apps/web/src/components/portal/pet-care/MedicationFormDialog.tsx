import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  petId: string;
  existing: any | null;
};

export default function MedicationFormDialog({ open, onOpenChange, petId, existing }: Props) {
  const { membership } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [timing, setTiming] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setDosage(existing?.dosage ?? "");
      setFrequency(existing?.frequency ?? "");
      setTiming(existing?.timing ?? "");
      setInstructions(existing?.instructions ?? "");
    }
  }, [open, existing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name is required");
    if (!membership?.organization_id) return toast.error("Missing organization");
    setBusy(true);
    const payload = {
      organization_id: membership.organization_id,
      pet_id: petId,
      name: name.trim(),
      dosage: dosage.trim() || null,
      frequency: frequency.trim() || null,
      timing: timing.trim() || null,
      instructions: instructions.trim() || null,
    };
    const { error } = existing
      ? await supabase.from("pet_medications").update(payload).eq("id", existing.id)
      : await supabase.from("pet_medications").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Medication updated" : "Medication added");
    qc.invalidateQueries({ queryKey: ["pet-medications", petId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit medication" : "Add medication"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Name *</Label>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Apoquel" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-dose">Dosage</Label>
              <Input id="m-dose" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="e.g., 50mg" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-freq">Frequency</Label>
              <Input id="m-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g., Twice daily" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-timing">Timing</Label>
            <Input id="m-timing" value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="e.g., Morning and evening, with food" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-instr">Instructions</Label>
            <Textarea id="m-instr" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Special instructions" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Add medication"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
