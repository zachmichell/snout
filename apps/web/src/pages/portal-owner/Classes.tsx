import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, Users, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  categoryLabel,
  formatInstanceDateTime,
  enrollmentStatusLabel,
  paymentStatusLabel,
} from "@/lib/classes";

function money(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

export default function OwnerClasses() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";
  const { data: owner } = useOwnerRecord();
  const qc = useQueryClient();

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [pickedInstance, setPickedInstance] = useState<any>(null);
  const [pickedPetId, setPickedPetId] = useState<string>("");

  // Available upcoming classes (joined to class_types for name/price)
  const { data: upcoming = [], isLoading: loadingUpcoming } = useQuery({
    queryKey: ["owner-upcoming-classes", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_instances")
        .select(
          `id, start_at, end_at, status,
           class_type:class_type_id(id, name, category, description, price_cents, max_enrollment, prerequisites)`,
        )
        .eq("organization_id", orgId)
        .eq("status", "scheduled")
        .gte("start_at", new Date().toISOString())
        .order("start_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Owner's pets
  const { data: pets = [] } = useQuery({
    queryKey: ["owner-pets", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("pet:pet_id(id, name)")
        .eq("owner_id", owner!.id);
      if (error) throw error;
      return ((data ?? []).map((r: any) => r.pet).filter(Boolean)) as { id: string; name: string }[];
    },
  });

  // Owner's existing enrollments
  const { data: enrollments = [], isLoading: loadingEnrollments } = useQuery({
    queryKey: ["owner-enrollments", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_enrollments")
        .select(
          `id, status, payment_status, attended, enrolled_at, class_instance_id,
           pet:pet_id(id, name),
           instance:class_instance_id(id, start_at, status, class_type:class_type_id(id, name, price_cents))`,
        )
        .eq("owner_id", owner!.id)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const enrolledInstanceIds = useMemo(
    () => new Set(enrollments.filter((e: any) => e.status !== "cancelled").map((e: any) => e.class_instance_id)),
    [enrollments],
  );

  const enroll = useMutation({
    mutationFn: async () => {
      if (!owner?.id || !orgId) throw new Error("Not signed in");
      if (!pickedInstance) throw new Error("Pick a class");
      if (!pickedPetId) throw new Error("Pick a pet");

      // Capacity check
      const { count } = await supabase
        .from("class_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("class_instance_id", pickedInstance.id)
        .eq("status", "enrolled");
      const max = pickedInstance.class_type?.max_enrollment ?? 0;
      const isWaitlist = max > 0 && (count ?? 0) >= max;

      const { error } = await supabase.from("class_enrollments").insert({
        organization_id: orgId,
        class_instance_id: pickedInstance.id,
        pet_id: pickedPetId,
        owner_id: owner.id,
        status: isWaitlist ? "waitlist" : "enrolled",
        payment_status: "unpaid",
      });
      if (error) throw error;
      return { isWaitlist };
    },
    onSuccess: ({ isWaitlist }) => {
      toast.success(isWaitlist ? "Added to waitlist (class is full)" : "You're enrolled! Pay later.");
      qc.invalidateQueries({ queryKey: ["owner-enrollments"] });
      setEnrollOpen(false);
      setPickedInstance(null);
      setPickedPetId("");
    },
    onError: (e: any) => toast.error(e.message ?? "Enrollment failed"),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("class_enrollments")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enrollment cancelled");
      qc.invalidateQueries({ queryKey: ["owner-enrollments"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Cancel failed"),
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-foreground flex items-center gap-2">
          <GraduationCap className="h-6 w-6" /> Classes & Training
        </h1>
        <p className="mt-1 text-sm text-foreground/70">Browse upcoming classes and manage your enrollments.</p>
      </div>

      <Tabs defaultValue="available">
        <TabsList>
          <TabsTrigger value="available"><Calendar className="h-4 w-4 mr-1.5" />Available</TabsTrigger>
          <TabsTrigger value="mine"><Users className="h-4 w-4 mr-1.5" />My Enrollments</TabsTrigger>
        </TabsList>

        <TabsContent value="available" className="mt-6">
          {loadingUpcoming ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-foreground/60">Loading…</div>
          ) : upcoming.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-foreground/60">
              No classes are scheduled at the moment. Check back soon!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcoming.map((inst: any) => {
                const ct = inst.class_type;
                const already = enrolledInstanceIds.has(inst.id);
                return (
                  <div key={inst.id} className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-semibold text-foreground">{ct?.name}</h3>
                        <Badge variant="secondary" className="mt-1">{categoryLabel(ct?.category ?? "")}</Badge>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">{money(ct?.price_cents ?? 0)}</div>
                      </div>
                    </div>
                    <div className="text-sm text-foreground/70 mb-3">{formatInstanceDateTime(inst.start_at)}</div>
                    {ct?.description && <p className="text-sm text-foreground/80 mb-3 line-clamp-3">{ct.description}</p>}
                    {ct?.prerequisites && (
                      <div className="text-xs text-foreground/60 mb-3"><span className="font-semibold">Prerequisites:</span> {ct.prerequisites}</div>
                    )}
                    <Button
                      className="w-full"
                      disabled={already || pets.length === 0}
                      onClick={() => {
                        setPickedInstance(inst);
                        setPickedPetId(pets[0]?.id ?? "");
                        setEnrollOpen(true);
                      }}
                    >
                      {already ? "Already Enrolled" : pets.length === 0 ? "Add a pet first" : "Enroll a Pet"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mine" className="mt-6">
          {loadingEnrollments ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-foreground/60">Loading…</div>
          ) : enrollments.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-foreground/60">
              You haven't enrolled in any classes yet.
            </div>
          ) : (
            <div className="space-y-3">
              {enrollments.map((e: any) => (
                <div key={e.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{e.instance?.class_type?.name ?? "—"}</div>
                    <div className="text-xs text-foreground/60 mt-0.5">
                      {e.pet?.name} · {e.instance?.start_at ? formatInstanceDateTime(e.instance.start_at) : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={e.status === "enrolled" ? "default" : "secondary"}>
                      {enrollmentStatusLabel(e.status)}
                    </Badge>
                    <Badge variant={e.payment_status === "paid" ? "default" : "secondary"}>
                      {paymentStatusLabel(e.payment_status)}
                    </Badge>
                    {e.status !== "cancelled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => {
                          if (confirm("Cancel this enrollment?")) cancel.mutate(e.id);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Enroll in {pickedInstance?.class_type?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div className="font-medium">{pickedInstance ? formatInstanceDateTime(pickedInstance.start_at) : ""}</div>
              <div className="text-foreground/70">{money(pickedInstance?.class_type?.price_cents ?? 0)} · pay later</div>
            </div>
            <div>
              <Label>Which pet?</Label>
              <Select value={pickedPetId} onValueChange={setPickedPetId}>
                <SelectTrigger><SelectValue placeholder="Pick a pet" /></SelectTrigger>
                <SelectContent>
                  {pets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button onClick={() => enroll.mutate()} disabled={enroll.isPending || !pickedPetId}>
              {enroll.isPending ? "Enrolling…" : "Confirm Enrollment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
