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

export default function FeedingFormDialog({ open, onOpenChange, petId, existing }: Props) {
  const { membership } = useAuth();
  const qc = useQueryClient();
  const [foodType, setFoodType] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("");
  const [timing, setTiming] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFoodType(existing?.food_type ?? "");
      setAmount(existing?.amount ?? "");
      setFrequency(existing?.frequency ?? "");
      setTiming(existing?.timing ?? "");
      setInstructions(existing?.instructions ?? "");
    }
  }, [open, existing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodType.trim()) return toast.error("Food type is required");
    if (!membership?.organization_id) return toast.error("Missing organization");
    setBusy(true);
    const payload = {
      organization_id: membership.organization_id,
      pet_id: petId,
      food_type: foodType.trim(),
      amount: amount.trim() || null,
      frequency: frequency.trim() || null,
      timing: timing.trim() || null,
      instructions: instructions.trim() || null,
    };
    const { error } = existing
      ? await supabase.from("pet_feeding_schedules").update(payload).eq("id", existing.id)
      : await supabase.from("pet_feeding_schedules").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Feeding schedule updated" : "Feeding schedule added");
    qc.invalidateQueries({ queryKey: ["pet-feeding", petId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit feeding schedule" : "Add feeding schedule"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="f-type">Food type *</Label>
            <Input id="f-type" value={foodType} onChange={(e) => setFoodType(e.target.value)} placeholder="e.g., Royal Canin Large Breed" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-amount">Amount</Label>
              <Input id="f-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g., 1 cup" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-freq">Frequency</Label>
              <Input id="f-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g., Twice daily" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-timing">Timing</Label>
            <Input id="f-timing" value={timing} onChange={(e) => setTiming(e.target.value)} placeholder="e.g., Morning and evening" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-instr">Instructions</Label>
            <Textarea id="f-instr" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g., Soak kibble in warm water" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Add feeding"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
