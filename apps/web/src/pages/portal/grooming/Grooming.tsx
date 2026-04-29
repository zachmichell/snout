import { useMemo, useState } from "react";
import PortalLayout from "@/components/portal/PortalLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Scissors,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  Inbox,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format, addDays, startOfWeek, endOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { useGroomingAppointments, type GroomingAppointment } from "@/hooks/useGroomingAppointments";
import { useGroomers } from "@/hooks/useGroomers";
import { usePermissions } from "@/hooks/usePermissions";
import TipDialog from "@/components/portal/TipDialog";
import GroomingAppointmentDialog from "./GroomingAppointmentDialog";

type ViewMode = "day" | "week";

const STATUS_META: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-teal-light text-teal" },
  in_progress: { label: "In Progress", className: "bg-warning-light text-warning" },
  completed: { label: "Completed", className: "bg-success-light text-success" },
  cancelled: { label: "Cancelled", className: "bg-muted text-text-secondary" },
  no_show: { label: "No Show", className: "bg-destructive-light text-destructive" },
  requested: { label: "Requested", className: "bg-primary-light text-primary" },
  pending: { label: "Pending", className: "bg-primary-light text-primary" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, className: "bg-muted text-text-secondary" };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", m.className)}>{m.label}</span>;
}

function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export default function Grooming() {
  const [date, setDate] = useState<Date>(new Date());
  const [view, setView] = useState<ViewMode>("day");
  const dateStr = format(date, "yyyy-MM-dd");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [tipFor, setTipFor] = useState<GroomingAppointment | null>(null);

  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canViewRevenue = can("revenue.view");

  const { data: appts = [], isLoading } = useGroomingAppointments(dateStr);
  const { data: groomers = [] } = useGroomers({ activeOnly: true });

  // Week range
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 });
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Week appointments query
  const { data: weekAppts = [] } = useQuery({
    queryKey: ["grooming-week", orgId, format(weekStart, "yyyy-MM-dd")],
    enabled: !!orgId && view === "week",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(
          "*, pet:pets(id,name), owner:owners(id,first_name,last_name), groomer:groomers(id,display_name)",
        )
        .eq("organization_id", orgId!)
        .gte("appointment_date", format(weekStart, "yyyy-MM-dd"))
        .lte("appointment_date", format(weekEnd, "yyyy-MM-dd"))
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as GroomingAppointment[];
    },
  });

  // Pending requests
  const { data: requests = [] } = useQuery({
    queryKey: ["grooming-requests", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grooming_appointments")
        .select(
          "*, pet:pets(id,name), owner:owners(id,first_name,last_name), groomer:groomers(id,display_name)",
        )
        .eq("organization_id", orgId!)
        .in("status", ["requested", "pending"])
        .order("appointment_date");
      if (error) throw error;
      return (data ?? []) as unknown as GroomingAppointment[];
    },
  });

  const stats = useMemo(() => {
    const scheduled = appts.filter((a) => a.status === "scheduled").length;
    const inProgress = appts.filter((a) => a.status === "in_progress").length;
    const completed = appts.filter((a) => a.status === "completed").length;
    const revenue = appts
      .filter((a) => a.status === "completed")
      .reduce((sum, a) => sum + (a.price_cents ?? 0), 0);
    const tips = appts
      .filter((a) => a.status === "completed")
      .reduce((sum, a: any) => sum + (a.tip_cents ?? 0), 0);
    return { scheduled, inProgress, completed, revenue, tips };
  }, [appts]);

  const transition = useMutation({
    mutationFn: async ({
      id,
      status,
      tip_cents,
    }: {
      id: string;
      status: string;
      tip_cents?: number | null;
    }) => {
      const updates: any = { status };
      if (status === "in_progress") updates.check_in_time = new Date().toISOString();
      if (status === "completed") updates.completed_time = new Date().toISOString();
      if (tip_cents !== undefined) updates.tip_cents = tip_cents;
      const { error } = await supabase.from("grooming_appointments").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(`Appointment ${STATUS_META[vars.status]?.label.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["grooming-appointments"] });
      qc.invalidateQueries({ queryKey: ["grooming-week"] });
      qc.invalidateQueries({ queryKey: ["grooming-requests"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const acceptMut = useMutation({
    mutationFn: async ({ id, groomer_id }: { id: string; groomer_id: string }) => {
      const { error } = await supabase
        .from("grooming_appointments")
        .update({ status: "scheduled", groomer_id })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request accepted");
      qc.invalidateQueries({ queryKey: ["grooming-requests"] });
      qc.invalidateQueries({ queryKey: ["grooming-appointments"] });
      qc.invalidateQueries({ queryKey: ["grooming-week"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const declineMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("grooming_appointments")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request declined");
      qc.invalidateQueries({ queryKey: ["grooming-requests"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const apptsByGroomer = useMemo(() => {
    const map = new Map<string, GroomingAppointment[]>();
    groomers.forEach((g) => map.set(g.id, []));
    appts.forEach((a) => {
      if (!map.has(a.groomer_id)) map.set(a.groomer_id, []);
      map.get(a.groomer_id)!.push(a);
    });
    return map;
  }, [appts, groomers]);

  // Week grid: groomer x day -> appointments
  const weekGrid = useMemo(() => {
    const m = new Map<string, GroomingAppointment[]>();
    for (const a of weekAppts) {
      const key = `${a.groomer_id}|${a.appointment_date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [weekAppts]);

  const renderActions = (a: GroomingAppointment) => {
    if (a.status === "scheduled") {
      return (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: a.id, status: "in_progress" })}>
            <Play className="h-3 w-3" /> Start
          </Button>
          <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: a.id, status: "cancelled" })}>
            <XCircle className="h-3 w-3" /> Cancel
          </Button>
          <Button size="sm" variant="outline" onClick={() => transition.mutate({ id: a.id, status: "no_show" })}>
            No Show
          </Button>
        </div>
      );
    }
    if (a.status === "in_progress") {
      return (
        <Button size="sm" onClick={() => setTipFor(a)}>
          <CheckCircle2 className="h-3 w-3" /> Complete
        </Button>
      );
    }
    if (a.status === "completed" && (a as any).tip_cents) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          Tip ${((a as any).tip_cents / 100).toFixed(2)}
        </span>
      );
    }
    return <span className="text-xs text-text-tertiary">—</span>;
  };

  const headerLabel =
    view === "day"
      ? format(date, "EEEE, MMM d, yyyy")
      : `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`;

  const shiftBy = (delta: number) =>
    setDate((d) => addDays(d, view === "day" ? delta : delta * 7));

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-foreground">Grooming</h1>
            <p className="mt-1 text-sm text-text-secondary">Schedule and track grooming appointments</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" /> New Appointment
            </Button>
          </div>
        </header>

        {/* Pending Requests */}
        <Collapsible open={requestsOpen} onOpenChange={setRequestsOpen} className="mb-6">
          <Card className="overflow-hidden border-border">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface"
              >
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-text-secondary" />
                  <span className="font-display text-base font-semibold text-foreground">
                    Pending Requests
                  </span>
                  <Badge
                    variant={requests.length > 0 ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {requests.length}
                  </Badge>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-text-tertiary transition-transform",
                    requestsOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-border-subtle">
                {requests.length === 0 ? (
                  <div className="p-6 text-center text-sm text-text-secondary">
                    No pending requests
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pet</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Services</TableHead>
                        <TableHead>Requested Date</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((r) => (
                        <RequestRow
                          key={r.id}
                          request={r}
                          groomers={groomers}
                          onAccept={(groomerId) =>
                            acceptMut.mutate({ id: r.id, groomer_id: groomerId })
                          }
                          onDecline={() => declineMut.mutate(r.id)}
                          loading={acceptMut.isPending || declineMut.isPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Date nav */}
        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftBy(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDate(new Date())}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => shiftBy(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="ml-2">
                <CalendarIcon className="h-4 w-4" />
                {headerLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        {view === "day" ? (
          <>
            {/* KPIs */}
            <div className={cn("mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2", canViewRevenue ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
              <Card className="p-4 border-l-4" style={{ borderLeftColor: "hsl(var(--brand-cotton))" }}>
                <div className="label-eyebrow">Scheduled Today</div>
                <div className="mt-1 font-display text-2xl text-foreground">{stats.scheduled}</div>
              </Card>
              <Card className="p-4 border-l-4" style={{ borderLeftColor: "hsl(var(--brand-vanilla))" }}>
                <div className="label-eyebrow">In Progress</div>
                <div className="mt-1 font-display text-2xl text-foreground">{stats.inProgress}</div>
              </Card>
              <Card className="p-4 border-l-4" style={{ borderLeftColor: "hsl(var(--brand-mist))" }}>
                <div className="label-eyebrow">Completed</div>
                <div className="mt-1 font-display text-2xl text-foreground">{stats.completed}</div>
              </Card>
              {canViewRevenue && (
                <Card className="p-4 border-l-4" style={{ borderLeftColor: "hsl(var(--brand-frost))" }}>
                  <div className="label-eyebrow">Revenue Today</div>
                  <div className="mt-1 font-display text-2xl text-foreground">
                    ${(stats.revenue / 100).toFixed(2)}
                  </div>
                  {stats.tips > 0 && (
                    <div className="mt-1 text-xs text-text-secondary">
                      + ${(stats.tips / 100).toFixed(2)} tips
                    </div>
                  )}
                </Card>
              )}
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
                <TabsTrigger value="by-groomer">By Groomer</TabsTrigger>
              </TabsList>

              <TabsContent value="schedule" className="mt-4">
                <Card className="p-0 overflow-hidden">
                  {isLoading ? (
                    <div className="p-8 text-sm text-text-secondary">Loading...</div>
                  ) : appts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
                      <Scissors className="h-8 w-8 text-text-tertiary" />
                      <div className="font-display text-base">No appointments</div>
                      <p className="text-sm text-text-secondary">Nothing scheduled for {format(date, "MMM d")}.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Pet</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead>Groomer</TableHead>
                          <TableHead>Services</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {appts.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">{fmtTime(a.start_time)}</TableCell>
                            <TableCell>{a.pet?.name ?? "—"}</TableCell>
                            <TableCell>{a.owner ? `${a.owner.first_name} ${a.owner.last_name}` : "—"}</TableCell>
                            <TableCell>{a.groomer?.display_name ?? "—"}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {a.services_requested.map((s) => (
                                  <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-text-secondary">{a.estimated_duration_minutes}m</TableCell>
                            <TableCell><StatusBadge status={a.status} /></TableCell>
                            <TableCell className="text-right">{renderActions(a)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="by-groomer" className="mt-4">
                {groomers.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-text-secondary">
                    No active groomers. Add some in Groomer Management.
                  </Card>
                ) : (
                  <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(groomers.length, 4)}, minmax(0, 1fr))` }}>
                    {groomers.map((g) => {
                      const list = apptsByGroomer.get(g.id) ?? [];
                      return (
                        <Card key={g.id} className="p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="font-display text-base">{g.display_name}</div>
                            <Badge variant="secondary" className="text-[10px]">{list.length}</Badge>
                          </div>
                          <div className="space-y-2">
                            {list.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-tertiary">
                                No appointments
                              </div>
                            ) : (
                              list.map((a) => (
                                <div key={a.id} className="rounded-lg border border-border bg-surface p-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                      <Clock className="h-3 w-3" />
                                      {fmtTime(a.start_time)} · {a.estimated_duration_minutes}m
                                    </div>
                                    <StatusBadge status={a.status} />
                                  </div>
                                  <div className="mt-1.5 text-sm font-medium">{a.pet?.name}</div>
                                  <div className="text-xs text-text-tertiary">
                                    {a.owner ? `${a.owner.first_name} ${a.owner.last_name}` : ""}
                                  </div>
                                  {a.services_requested.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {a.services_requested.map((s) => (
                                        <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <Card className="overflow-hidden p-0">
            {groomers.length === 0 ? (
              <div className="p-8 text-center text-sm text-text-secondary">
                No active groomers. Add some in Groomer Management.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div
                  className="grid border-b border-border bg-surface"
                  style={{ gridTemplateColumns: `200px repeat(7, minmax(140px, 1fr))` }}
                >
                  <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Groomer
                  </div>
                  {weekDays.map((d) => (
                    <div
                      key={d.toISOString()}
                      className="border-l border-border-subtle px-3 py-3 text-center"
                    >
                      <div className="text-xs font-semibold uppercase">{format(d, "EEE")}</div>
                      <div className="text-[11px] text-text-secondary">{format(d, "MMM d")}</div>
                    </div>
                  ))}
                </div>
                {groomers.map((g) => (
                  <div
                    key={g.id}
                    className="grid border-b border-border-subtle last:border-b-0"
                    style={{ gridTemplateColumns: `200px repeat(7, minmax(140px, 1fr))` }}
                  >
                    <div className="border-r border-border-subtle px-4 py-3 font-medium text-foreground">
                      {g.display_name}
                    </div>
                    {weekDays.map((d) => {
                      const list = weekGrid.get(`${g.id}|${format(d, "yyyy-MM-dd")}`) ?? [];
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => {
                            setDate(d);
                            setView("day");
                          }}
                          className={cn(
                            "min-h-[80px] border-l border-border-subtle px-2 py-2 text-left text-xs transition-colors hover:bg-surface",
                            list.length === 0 && "text-text-tertiary",
                          )}
                        >
                          {list.length === 0 ? (
                            <span className="opacity-40">—</span>
                          ) : (
                            <div className="space-y-1">
                              <Badge variant="secondary" className="text-[10px]">
                                {list.length}
                              </Badge>
                              {list.slice(0, 3).map((a) => (
                                <div
                                  key={a.id}
                                  className="truncate rounded bg-primary-light px-1.5 py-0.5 text-[10px] text-primary"
                                >
                                  {fmtTime(a.start_time)} · {a.pet?.name}
                                </div>
                              ))}
                              {list.length > 3 && (
                                <div className="text-[10px] text-text-tertiary">
                                  +{list.length - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <GroomingAppointmentDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultDate={dateStr} />

      <TipDialog
        open={!!tipFor}
        onOpenChange={(o) => !o && setTipFor(null)}
        title="Add Tip"
        description={tipFor?.pet?.name ? `For ${tipFor.pet.name}'s grooming` : undefined}
        busy={transition.isPending}
        confirmLabel="Save & Complete"
        onConfirm={async (cents) => {
          if (!tipFor) return;
          await new Promise<void>((resolve, reject) => {
            transition.mutate(
              { id: tipFor.id, status: "completed", tip_cents: cents },
              { onSuccess: () => resolve(), onError: (e) => reject(e) },
            );
          });
          setTipFor(null);
        }}
      />
    </PortalLayout>
  );
}

function RequestRow({
  request,
  groomers,
  onAccept,
  onDecline,
  loading,
}: {
  request: GroomingAppointment;
  groomers: { id: string; display_name: string }[];
  onAccept: (groomerId: string) => void;
  onDecline: () => void;
  loading: boolean;
}) {
  const [selectedGroomer, setSelectedGroomer] = useState<string>(
    request.groomer_id || groomers[0]?.id || "",
  );
  return (
    <TableRow>
      <TableCell className="font-medium">{request.pet?.name ?? "—"}</TableCell>
      <TableCell>
        {request.owner ? `${request.owner.first_name} ${request.owner.last_name}` : "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {request.services_requested.length === 0 ? (
            <span className="text-xs text-text-tertiary">—</span>
          ) : (
            request.services_requested.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px]">
                {s}
              </Badge>
            ))
          )}
        </div>
      </TableCell>
      <TableCell className="text-text-secondary">
        {request.appointment_date} · {fmtTime(request.start_time)}
      </TableCell>
      <TableCell className="max-w-[200px] truncate text-xs text-text-secondary">
        {request.notes || "—"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <Select value={selectedGroomer} onValueChange={setSelectedGroomer}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Assign groomer" />
            </SelectTrigger>
            <SelectContent>
              {groomers.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectedGroomer || loading}
            onClick={() => onAccept(selectedGroomer)}
          >
            <CheckCircle2 className="h-3 w-3" /> Accept
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={onDecline}>
            <XCircle className="h-3 w-3" /> Decline
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
