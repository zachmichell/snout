import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Mode = "single" | "series";

export default function EnrollmentDialog({
  open,
  onOpenChange,
  defaultInstanceId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultInstanceId?: string;
}) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [mode, setMode] = useState<Mode>("single");
  const [instanceId, setInstanceId] = useState(defaultInstanceId ?? "");
  const [seriesId, setSeriesId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [petId, setPetId] = useState("");

  useEffect(() => {
    if (open) {
      setMode(defaultInstanceId ? "single" : "single");
      setInstanceId(defaultInstanceId ?? "");
      setSeriesId("");
      setOwnerId("");
      setPetId("");
    }
  }, [open, defaultInstanceId]);

  const { data: instances = [] } = useQuery({
    queryKey: ["class-instances-pickable", orgId],
    enabled: !!orgId && open && mode === "single",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_instances")
        .select("id, start_at, status, class_type:class_type_id(name)")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "scheduled")
        .gte("start_at", new Date().toISOString())
        .order("start_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: seriesList = [] } = useQuery({
    queryKey: ["class-series-pickable", orgId],
    enabled: !!orgId && open && mode === "series",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_series")
        .select("id, start_date, session_count, status, class_type:class_type_id(name)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: owners = [] } = useQuery({
    queryKey: ["owners-for-enroll", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, first_name, last_name")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("last_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pets = [] } = useQuery({
    queryKey: ["pets-for-owner", ownerId],
    enabled: !!ownerId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("pet:pet_id(id, name)")
        .eq("owner_id", ownerId);
      if (error) throw error;
      return ((data ?? []).map((r: any) => r.pet).filter(Boolean)) as { id: string; name: string }[];
    },
  });

  const enroll = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (!ownerId || !petId) throw new Error("Pick an owner and pet");

      if (mode === "series") {
        if (!seriesId) throw new Error("Pick a series");
        // Already enrolled in this series?
        const { count: existing } = await supabase
          .from("class_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("series_id", seriesId)
          .eq("pet_id", petId)
          .neq("status", "cancelled");
        if ((existing ?? 0) > 0) throw new Error("This pet is already enrolled in the series");

        // One enrollment per scheduled session in the series.
        const { data: insts, error: instErr } = await supabase
          .from("class_instances")
          .select("id")
          .eq("series_id", seriesId)
          .eq("status", "scheduled")
          .is("deleted_at", null);
        if (instErr) throw instErr;
        if (!insts || insts.length === 0) throw new Error("This series has no upcoming sessions");

        const rows = insts.map((i) => ({
          organization_id: orgId,
          class_instance_id: i.id,
          pet_id: petId,
          owner_id: ownerId,
          series_id: seriesId,
          status: "enrolled",
          payment_status: "unpaid",
        }));
        const { error } = await supabase.from("class_enrollments").insert(rows);
        if (error) throw error;
        await logActivity({
          organization_id: orgId,
          action: "created",
          entity_type: "class_enrollment",
          entity_id: seriesId,
          metadata: { series_id: seriesId, pet_id: petId, sessions: rows.length },
        });
        return { mode, sessions: rows.length };
      }

      // Single session
      if (!instanceId) throw new Error("Pick a class");
      const [{ data: inst }, { count }] = await Promise.all([
        supabase
          .from("class_instances")
          .select("id, start_at, class_type:class_type_id(name, max_enrollment, price_cents)")
          .eq("id", instanceId)
          .single(),
        supabase
          .from("class_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("class_instance_id", instanceId)
          .eq("status", "enrolled"),
      ]);
      if (!inst) throw new Error("Class not found");
      const max = (inst.class_type as any)?.max_enrollment ?? 0;
      const isWaitlist = max > 0 && (count ?? 0) >= max;

      const { data: enr, error } = await supabase
        .from("class_enrollments")
        .insert({
          organization_id: orgId,
          class_instance_id: instanceId,
          pet_id: petId,
          owner_id: ownerId,
          status: isWaitlist ? "waitlist" : "enrolled",
          payment_status: "unpaid",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "created",
        entity_type: "class_enrollment",
        entity_id: enr.id,
        metadata: { class_instance_id: instanceId, pet_id: petId, status: isWaitlist ? "waitlist" : "enrolled" },
      });
      return { mode, isWaitlist };
    },
    onSuccess: (res: any) => {
      if (res.mode === "series") {
        toast.success(`Pet enrolled in all ${res.sessions} sessions`);
      } else {
        toast.success(res.isWaitlist ? "Added to waitlist (class is full)" : "Pet enrolled");
      }
      qc.invalidateQueries({ queryKey: ["class-enrollments"] });
      qc.invalidateQueries({ queryKey: ["class-instances"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Enrollment failed"),
  });

  const canSubmit = !!ownerId && !!petId && (mode === "single" ? !!instanceId : !!seriesId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Enroll a Pet</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Enroll in</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">A single class</SelectItem>
                <SelectItem value="series">A full series (all sessions)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "single" ? (
            <div>
              <Label>Class</Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a class" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {(i.class_type?.name ?? "Class")} — {new Date(i.start_at).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Series</Label>
              <Select value={seriesId} onValueChange={setSeriesId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a series" />
                </SelectTrigger>
                <SelectContent>
                  {seriesList.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {(s.class_type?.name ?? "Series")} — starts{" "}
                      {new Date(s.start_date).toLocaleDateString()} ({s.session_count} sessions)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Owner</Label>
            <Select
              value={ownerId}
              onValueChange={(v) => {
                setOwnerId(v);
                setPetId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick an owner" />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.first_name} {o.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pet</Label>
            <Select value={petId} onValueChange={setPetId} disabled={!ownerId}>
              <SelectTrigger>
                <SelectValue placeholder={ownerId ? "Pick a pet" : "Pick owner first"} />
              </SelectTrigger>
              <SelectContent>
                {pets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => enroll.mutate()} disabled={enroll.isPending || !canSubmit}>
            {enroll.isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
