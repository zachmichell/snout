import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ClassInstanceFormDialog({
  open,
  onOpenChange,
  defaultClassTypeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClassTypeId?: string;
}) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [classTypeId, setClassTypeId] = useState<string>(defaultClassTypeId ?? "");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setClassTypeId(defaultClassTypeId ?? "");
      setDate("");
      setTime("");
      setNotes("");
    }
  }, [open, defaultClassTypeId]);

  const { data: classTypes = [] } = useQuery({
    queryKey: ["class-types", orgId, "active"],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("id, name, duration_minutes, instructor_user_id")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (!classTypeId) throw new Error("Pick a class type");
      if (!date || !time) throw new Error("Date and time are required");
      const ct = classTypes.find((c: any) => c.id === classTypeId);
      if (!ct) throw new Error("Class type not found");
      const start = new Date(`${date}T${time}`);
      const end = new Date(start.getTime() + (ct.duration_minutes ?? 60) * 60_000);
      const { data, error } = await supabase
        .from("class_instances")
        .insert({
          organization_id: orgId,
          class_type_id: classTypeId,
          instructor_user_id: ct.instructor_user_id ?? null,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          status: "scheduled",
          notes: notes.trim() || null,
          auto_generated: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "created",
        entity_type: "class_instance",
        entity_id: data.id,
        metadata: { class_type_id: classTypeId, start_at: start.toISOString() },
      });
    },
    onSuccess: () => {
      toast.success("Class instance scheduled");
      qc.invalidateQueries({ queryKey: ["class-instances"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create instance"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Schedule a Class</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Class Type</Label>
            <Select value={classTypeId} onValueChange={setClassTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a class type" />
              </SelectTrigger>
              <SelectContent>
                {classTypes.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
