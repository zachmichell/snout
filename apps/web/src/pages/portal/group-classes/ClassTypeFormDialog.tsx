import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { CLASS_CATEGORIES, generateWeeklyOccurrences } from "@/lib/classes";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type ClassType = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  max_enrollment: number;
  duration_minutes: number;
  price_cents: number;
  instructor_user_id: string | null;
  schedule_day_of_week: number | null;
  schedule_time: string | null;
  prerequisites: string | null;
  status: string;
};

const DAYS = [
  { v: 0, l: "Sunday" },
  { v: 1, l: "Monday" },
  { v: 2, l: "Tuesday" },
  { v: 3, l: "Wednesday" },
  { v: 4, l: "Thursday" },
  { v: 5, l: "Friday" },
  { v: 6, l: "Saturday" },
];

export default function ClassTypeFormDialog({
  open,
  onOpenChange,
  classType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classType: ClassType | null;
}) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [name, setName] = useState("");
  const [category, setCategory] = useState("obedience");
  const [description, setDescription] = useState("");
  const [maxEnroll, setMaxEnroll] = useState(10);
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState("0");
  const [instructorUserId, setInstructorUserId] = useState<string>("none");
  const [day, setDay] = useState<string>("none");
  const [time, setTime] = useState<string>("");
  const [prereqs, setPrereqs] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [autoGen, setAutoGen] = useState(true);
  const [autoCount, setAutoCount] = useState(8);

  useEffect(() => {
    if (classType) {
      setName(classType.name);
      setCategory(classType.category);
      setDescription(classType.description ?? "");
      setMaxEnroll(classType.max_enrollment);
      setDuration(classType.duration_minutes);
      setPrice(((classType.price_cents ?? 0) / 100).toFixed(2));
      setInstructorUserId(classType.instructor_user_id ?? "none");
      setDay(classType.schedule_day_of_week == null ? "none" : String(classType.schedule_day_of_week));
      setTime(classType.schedule_time ?? "");
      setPrereqs(classType.prerequisites ?? "");
      setStatus(classType.status);
      setAutoGen(false);
    } else {
      setName("");
      setCategory("obedience");
      setDescription("");
      setMaxEnroll(10);
      setDuration(60);
      setPrice("0");
      setInstructorUserId("none");
      setDay("none");
      setTime("");
      setPrereqs("");
      setStatus("active");
      setAutoGen(true);
      setAutoCount(8);
    }
  }, [classType, open]);

  const { data: staff = [] } = useQuery({
    queryKey: ["staff-list", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data: members } = await supabase
        .from("memberships")
        .select("profile_id")
        .eq("organization_id", orgId)
        .eq("active", true);
      const ids = (members ?? []).map((m) => m.profile_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", ids);
      return profs ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      const payload = {
        organization_id: orgId,
        name: name.trim(),
        category,
        description: description.trim() || null,
        max_enrollment: Math.max(1, Math.floor(Number(maxEnroll) || 1)),
        duration_minutes: Math.max(5, Math.floor(Number(duration) || 60)),
        price_cents: Math.round(Number(price || "0") * 100),
        instructor_user_id: instructorUserId === "none" ? null : instructorUserId,
        schedule_day_of_week: day === "none" ? null : Number(day),
        schedule_time: day === "none" ? null : time || null,
        prerequisites: prereqs.trim() || null,
        status,
      };
      if (!payload.name) throw new Error("Name is required");

      let id = classType?.id;
      if (classType) {
        const { error } = await supabase.from("class_types").update(payload).eq("id", classType.id);
        if (error) throw error;
        await logActivity({
          organization_id: orgId,
          action: "updated",
          entity_type: "class_type",
          entity_id: classType.id,
          metadata: { name: payload.name },
        });
      } else {
        const { data, error } = await supabase.from("class_types").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
        await logActivity({
          organization_id: orgId,
          action: "created",
          entity_type: "class_type",
          entity_id: id,
          metadata: { name: payload.name },
        });
        // Auto-generate upcoming instances if requested
        if (autoGen && payload.schedule_day_of_week != null && payload.schedule_time && id) {
          const occurrences = generateWeeklyOccurrences(
            payload.schedule_day_of_week,
            payload.schedule_time,
            payload.duration_minutes,
            new Date(),
            Math.max(1, Math.min(52, autoCount)),
          );
          if (occurrences.length > 0) {
            const { error: insErr } = await supabase.from("class_instances").insert(
              occurrences.map((o) => ({
                organization_id: orgId,
                class_type_id: id!,
                instructor_user_id: payload.instructor_user_id,
                start_at: o.start_at,
                end_at: o.end_at,
                status: "scheduled",
                auto_generated: true,
              })),
            );
            if (insErr) throw insErr;
          }
        }
      }
    },
    onSuccess: () => {
      toast.success(classType ? "Class type updated" : "Class type created");
      qc.invalidateQueries({ queryKey: ["class-types"] });
      qc.invalidateQueries({ queryKey: ["class-instances"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{classType ? "Edit Class Type" : "New Class Type"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Beginner Obedience" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Max Enrollment</Label>
              <Input type="number" min={1} value={maxEnroll} onChange={(e) => setMaxEnroll(Number(e.target.value))} />
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input type="number" min={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
            <div>
              <Label>Price</Label>
              <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label>Instructor</Label>
              <Select value={instructorUserId} onValueChange={setInstructorUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {staff.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recurring Day</Label>
              <Select value={day} onValueChange={setDay}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (manual instances only)</SelectItem>
                  {DAYS.map((d) => (
                    <SelectItem key={d.v} value={String(d.v)}>
                      {d.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={day === "none"} />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="col-span-2">
              <Label>Prerequisites</Label>
              <Textarea value={prereqs} onChange={(e) => setPrereqs(e.target.value)} rows={2} placeholder="e.g. Must have completed Puppy 101" />
            </div>
          </div>

          {!classType && day !== "none" && time && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="cursor-pointer">Auto-generate upcoming instances</Label>
                  <p className="text-xs text-text-secondary mt-0.5">Create scheduled occurrences from this recurring schedule.</p>
                </div>
                <Switch checked={autoGen} onCheckedChange={setAutoGen} />
              </div>
              {autoGen && (
                <div className="mt-3">
                  <Label>Number of weeks to generate</Label>
                  <Input
                    type="number"
                    min={1}
                    max={52}
                    value={autoCount}
                    onChange={(e) => setAutoCount(Number(e.target.value))}
                    className="w-32"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending ? "Saving…" : classType ? "Save Changes" : "Create Class Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
