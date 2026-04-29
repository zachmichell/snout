import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Calendar, Users, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import {
  categoryLabel,
  formatScheduleSummary,
  formatInstanceDateTime,
  instanceStatusLabel,
  enrollmentStatusLabel,
  paymentStatusLabel,
} from "@/lib/classes";
import ClassTypeFormDialog from "./ClassTypeFormDialog";
import ClassInstanceFormDialog from "./ClassInstanceFormDialog";
import EnrollmentDialog from "./EnrollmentDialog";

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format((cents ?? 0) / 100);
}

export default function GroupClasses() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";
  const qc = useQueryClient();

  const [tab, setTab] = useState("types");
  const [typeDialog, setTypeDialog] = useState(false);
  const [editingType, setEditingType] = useState<any>(null);
  const [instanceDialog, setInstanceDialog] = useState(false);
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [enrollDefaultInstance, setEnrollDefaultInstance] = useState<string | undefined>();
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);

  // ----- Class Types -----
  const { data: classTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: ["class-types", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_types")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ----- Upcoming Instances -----
  const { data: instances = [], isLoading: loadingInstances } = useQuery({
    queryKey: ["class-instances", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_instances")
        .select(
          `id, start_at, end_at, status, notes, instructor_user_id,
           class_type:class_type_id(id, name, max_enrollment, category)`,
        )
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("start_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ----- Enrollments (for counts + table) -----
  const { data: enrollments = [], isLoading: loadingEnrollments } = useQuery({
    queryKey: ["class-enrollments", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_enrollments")
        .select(
          `id, status, attended, payment_status, enrolled_at, class_instance_id,
           pet:pet_id(id, name),
           owner:owner_id(id, first_name, last_name),
           instance:class_instance_id(id, start_at, class_type:class_type_id(id, name))`,
        )
        .eq("organization_id", orgId)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const enrollmentCountByInstance = new Map<string, number>();
  enrollments.forEach((e: any) => {
    if (e.status === "enrolled") {
      enrollmentCountByInstance.set(e.class_instance_id, (enrollmentCountByInstance.get(e.class_instance_id) ?? 0) + 1);
    }
  });

  const archiveType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("class_types")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "deleted",
        entity_type: "class_type",
        entity_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Class type archived");
      qc.invalidateQueries({ queryKey: ["class-types"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Archive failed"),
  });

  const updateInstanceStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("class_instances").update({ status }).eq("id", id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "updated",
        entity_type: "class_instance",
        entity_id: id,
        metadata: { status },
      });
    },
    onSuccess: () => {
      toast.success("Class updated");
      qc.invalidateQueries({ queryKey: ["class-instances"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const setAttendance = useMutation({
    mutationFn: async ({ id, attended }: { id: string; attended: boolean | null }) => {
      const { error } = await supabase.from("class_enrollments").update({ attended }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-enrollments"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const setPaymentStatus = useMutation({
    mutationFn: async ({ id, payment_status }: { id: string; payment_status: string }) => {
      const { error } = await supabase.from("class_enrollments").update({ payment_status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-enrollments"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const cancelEnrollment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("class_enrollments")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "cancelled",
        entity_type: "class_enrollment",
        entity_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Enrollment cancelled");
      qc.invalidateQueries({ queryKey: ["class-enrollments"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Cancel failed"),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Group Classes & Training"
          description="Manage class types, schedule sessions, and track enrollments."
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="types"><GraduationCap className="h-4 w-4 mr-1.5" />Class Types</TabsTrigger>
            <TabsTrigger value="upcoming"><Calendar className="h-4 w-4 mr-1.5" />Upcoming Classes</TabsTrigger>
            <TabsTrigger value="enrollments"><Users className="h-4 w-4 mr-1.5" />Enrollments</TabsTrigger>
          </TabsList>

          {/* CLASS TYPES TAB */}
          <TabsContent value="types" className="mt-6">
            <div className="mb-4 flex justify-end">
              <Button
                onClick={() => {
                  setEditingType(null);
                  setTypeDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" /> New Class Type
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingTypes ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-text-secondary">Loading…</TableCell></TableRow>
                  ) : classTypes.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-text-secondary">No class types yet. Create your first one.</TableCell></TableRow>
                  ) : (
                    classTypes.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{categoryLabel(c.category)}</TableCell>
                        <TableCell className="text-right">{c.max_enrollment}</TableCell>
                        <TableCell className="text-right">{c.duration_minutes} min</TableCell>
                        <TableCell className="text-right">{money(c.price_cents)}</TableCell>
                        <TableCell className="text-text-secondary">{formatScheduleSummary(c.schedule_day_of_week, c.schedule_time)}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingType(c);
                              setTypeDialog(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                            onClick={() => {
                              if (confirm(`Archive class type "${c.name}"?`)) archiveType.mutate(c.id);
                            }}
                          >
                            Archive
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* UPCOMING TAB */}
          <TabsContent value="upcoming" className="mt-6">
            <div className="mb-4 flex justify-end">
              <Button onClick={() => setInstanceDialog(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Schedule a Class
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Class Name</TableHead>
                    <TableHead>Date / Time</TableHead>
                    <TableHead className="text-right">Enrolled</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[260px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInstances ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-text-secondary">Loading…</TableCell></TableRow>
                  ) : instances.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-text-secondary">No classes scheduled yet.</TableCell></TableRow>
                  ) : (
                    instances.map((i: any) => {
                      const max = i.class_type?.max_enrollment ?? 0;
                      const enrolled = enrollmentCountByInstance.get(i.id) ?? 0;
                      const roster = enrollments.filter((e: any) => e.class_instance_id === i.id);
                      const isExpanded = expandedInstance === i.id;
                      return (
                        <>
                          <TableRow key={i.id}>
                            <TableCell className="font-medium">{i.class_type?.name ?? "—"}</TableCell>
                            <TableCell>{formatInstanceDateTime(i.start_at)}</TableCell>
                            <TableCell className="text-right">
                              <span className={enrolled >= max ? "text-warning font-semibold" : ""}>
                                {enrolled}/{max}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={i.status === "scheduled" ? "default" : "secondary"}>
                                {instanceStatusLabel(i.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpandedInstance(isExpanded ? null : i.id)}
                              >
                                {isExpanded ? "Hide" : "Roster"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEnrollDefaultInstance(i.id);
                                  setEnrollDialog(true);
                                }}
                              >
                                Enroll
                              </Button>
                              {i.status === "scheduled" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => updateInstanceStatus.mutate({ id: i.id, status: "completed" })}
                                  >
                                    Complete
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-danger"
                                    onClick={() => {
                                      if (confirm("Cancel this class?")) updateInstanceStatus.mutate({ id: i.id, status: "cancelled" });
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow>
                              <TableCell colSpan={5} className="bg-muted/20 p-4">
                                <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">Roster</div>
                                {roster.length === 0 ? (
                                  <div className="text-sm text-text-secondary">No enrollments yet.</div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {roster.map((e: any) => (
                                      <div key={e.id} className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2 border border-border">
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium">{e.pet?.name ?? "—"}</div>
                                          <div className="text-xs text-text-secondary">
                                            {e.owner?.first_name} {e.owner?.last_name} · {enrollmentStatusLabel(e.status)} · {paymentStatusLabel(e.payment_status)}
                                          </div>
                                        </div>
                                        <Select
                                          value={e.attended === true ? "yes" : e.attended === false ? "no" : "unset"}
                                          onValueChange={(v) =>
                                            setAttendance.mutate({
                                              id: e.id,
                                              attended: v === "yes" ? true : v === "no" ? false : null,
                                            })
                                          }
                                        >
                                          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="unset">— Attendance —</SelectItem>
                                            <SelectItem value="yes">Attended</SelectItem>
                                            <SelectItem value="no">Absent</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ENROLLMENTS TAB */}
          <TabsContent value="enrollments" className="mt-6">
            <div className="mb-4 flex justify-end">
              <Button
                onClick={() => {
                  setEnrollDefaultInstance(undefined);
                  setEnrollDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" /> New Enrollment
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Pet</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingEnrollments ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-text-secondary">Loading…</TableCell></TableRow>
                  ) : enrollments.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-text-secondary">No enrollments yet.</TableCell></TableRow>
                  ) : (
                    enrollments.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.pet?.name ?? "—"}</TableCell>
                        <TableCell>{e.owner?.first_name} {e.owner?.last_name}</TableCell>
                        <TableCell>
                          <div className="text-sm">{e.instance?.class_type?.name ?? "—"}</div>
                          <div className="text-xs text-text-secondary">{e.instance?.start_at ? formatInstanceDateTime(e.instance.start_at) : ""}</div>
                        </TableCell>
                        <TableCell className="text-text-secondary text-sm">
                          {new Date(e.enrolled_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={e.payment_status}
                            onValueChange={(v) => setPaymentStatus.mutate({ id: e.id, payment_status: v })}
                          >
                            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unpaid">Unpaid</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="refunded">Refunded</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge variant={e.status === "enrolled" ? "default" : "secondary"}>
                            {enrollmentStatusLabel(e.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {e.status !== "cancelled" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger"
                              onClick={() => {
                                if (confirm("Cancel this enrollment?")) cancelEnrollment.mutate(e.id);
                              }}
                            >
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ClassTypeFormDialog open={typeDialog} onOpenChange={setTypeDialog} classType={editingType} />
      <ClassInstanceFormDialog open={instanceDialog} onOpenChange={setInstanceDialog} />
      <EnrollmentDialog open={enrollDialog} onOpenChange={setEnrollDialog} defaultInstanceId={enrollDefaultInstance} />
    </PortalLayout>
  );
}
