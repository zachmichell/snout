import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pause, Play, X, Calendar } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { describeSchedule } from "@/lib/recurrence";
import { logActivity } from "@/lib/activity";

type Group = {
  id: string;
  organization_id: string;
  owner_id: string;
  pet_ids: string[];
  service_id: string | null;
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
  status: string;
  start_time: string;
  end_time: string;
  created_at: string;
};

type Reservation = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  recurring_group_id: string | null;
};

const STATUS_VARIANT: Record<string, string> = {
  active: "bg-success-light text-success",
  paused: "bg-warning-light text-warning",
  cancelled: "bg-muted text-muted-foreground",
};

export function StandingReservationsSection({ showHeader = true }: { showHeader?: boolean } = {}) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["recurring-groups", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_reservation_groups")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Group[];
    },
  });

  // Fetch related owners, pets, services in one batch
  const ownerIds = useMemo(() => Array.from(new Set(groups.map((g) => g.owner_id))), [groups]);
  const allPetIds = useMemo(
    () => Array.from(new Set(groups.flatMap((g) => g.pet_ids ?? []))),
    [groups],
  );
  const serviceIds = useMemo(
    () => Array.from(new Set(groups.map((g) => g.service_id).filter(Boolean) as string[])),
    [groups],
  );

  const { data: owners = [] } = useQuery({
    queryKey: ["recurring-owners", ownerIds],
    enabled: ownerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, first_name, last_name")
        .in("id", ownerIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const ownerMap = useMemo(() => new Map(owners.map((o) => [o.id, o])), [owners]);

  const { data: pets = [] } = useQuery({
    queryKey: ["recurring-pets", allPetIds],
    enabled: allPetIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pets").select("id, name").in("id", allPetIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const petMap = useMemo(() => new Map(pets.map((p) => [p.id, p])), [pets]);

  const { data: services = [] } = useQuery({
    queryKey: ["recurring-services", serviceIds],
    enabled: serviceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("id, name").in("id", serviceIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  // Per-group instances (only loaded when expanded)
  const expandedGroupIds = Array.from(expanded);
  const { data: instancesByGroup = {} } = useQuery({
    queryKey: ["recurring-instances", expandedGroupIds],
    enabled: expandedGroupIds.length > 0 && !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, start_at, end_at, status, recurring_group_id")
        .in("recurring_group_id", expandedGroupIds)
        .order("start_at", { ascending: true });
      if (error) throw error;
      const map: Record<string, Reservation[]> = {};
      for (const r of data ?? []) {
        const k = r.recurring_group_id!;
        if (!map[k]) map[k] = [];
        map[k].push(r as Reservation);
      }
      return map;
    },
  });

  const toggleExpand = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setStatus = useMutation({
    mutationFn: async ({ group, status }: { group: Group; status: "active" | "paused" | "cancelled" }) => {
      const { error } = await supabase
        .from("recurring_reservation_groups")
        .update({ status })
        .eq("id", group.id);
      if (error) throw error;

      // For pause / cancel, also cancel any future instances that are still requested/confirmed.
      if (status === "paused" || status === "cancelled") {
        const nowIso = new Date().toISOString();
        const { error: rErr } = await supabase
          .from("reservations")
          .update({
            status: "cancelled",
            cancelled_at: nowIso,
            cancelled_reason: status === "paused" ? "Recurring series paused" : "Recurring series cancelled",
          })
          .eq("recurring_group_id", group.id)
          .gte("start_at", nowIso)
          .in("status", ["requested", "confirmed"]);
        if (rErr) throw rErr;
      }

      await logActivity({
        organization_id: group.organization_id,
        action: status === "active" ? "recurring_resumed" : status === "paused" ? "recurring_paused" : "recurring_cancelled",
        entity_type: "recurring_reservation_group",
        entity_id: group.id,
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "active"
          ? "Series resumed"
          : vars.status === "paused"
            ? "Series paused — future instances cancelled"
            : "Series cancelled — future instances cancelled",
      );
      qc.invalidateQueries({ queryKey: ["recurring-groups", orgId] });
      qc.invalidateQueries({ queryKey: ["recurring-instances"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <>
      {showHeader && (
        <PageHeader
          title="Standing Reservations"
          description="Recurring schedules that auto-generate reservations."
        />
      )}

        <Card className="mt-6 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Owner</TableHead>
                <TableHead>Pets</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    <Calendar className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                    No recurring reservations yet. Create one from the New Reservation form.
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((g) => {
                  const isOpen = expanded.has(g.id);
                  const owner = ownerMap.get(g.owner_id);
                  const ownerName = owner ? `${owner.first_name} ${owner.last_name}` : "—";
                  const petNames = (g.pet_ids ?? [])
                    .map((pid) => petMap.get(pid)?.name)
                    .filter(Boolean)
                    .join(", ");
                  const serviceName = g.service_id ? serviceMap.get(g.service_id)?.name ?? "—" : "—";
                  const instances = instancesByGroup[g.id] ?? [];
                  return (
                    <>
                      <TableRow key={g.id}>
                        <TableCell>
                          <button
                            onClick={() => toggleExpand(g.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={isOpen ? "Collapse" : "Expand"}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{ownerName}</TableCell>
                        <TableCell className="text-sm">{petNames || "—"}</TableCell>
                        <TableCell className="text-sm">{serviceName}</TableCell>
                        <TableCell className="text-sm">{describeSchedule(g.days_of_week)}</TableCell>
                        <TableCell className="text-sm">
                          {new Date(g.start_date + "T00:00:00").toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {g.end_date ? new Date(g.end_date + "T00:00:00").toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_VARIANT[g.status] ?? ""}>{g.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {g.status === "active" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setStatus.mutate({ group: g, status: "paused" })}
                              >
                                <Pause className="mr-1 h-3.5 w-3.5" /> Pause
                              </Button>
                            )}
                            {g.status === "paused" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setStatus.mutate({ group: g, status: "active" })}
                              >
                                <Play className="mr-1 h-3.5 w-3.5" /> Resume
                              </Button>
                            )}
                            {g.status !== "cancelled" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("Cancel this series and all future instances?")) {
                                    setStatus.mutate({ group: g, status: "cancelled" });
                                  }
                                }}
                              >
                                <X className="mr-1 h-3.5 w-3.5" /> Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={8} className="py-3">
                            <div className="label-eyebrow mb-2">Instances ({instances.length})</div>
                            {instances.length === 0 ? (
                              <div className="text-xs text-muted-foreground">No instances yet.</div>
                            ) : (
                              <ul className="space-y-1">
                                {instances.map((r) => {
                                  const start = new Date(r.start_at);
                                  return (
                                    <li
                                      key={r.id}
                                      className="flex items-center justify-between rounded border border-border-subtle bg-card px-3 py-1.5"
                                    >
                                      <Link
                                        to={`/reservations/${r.id}`}
                                        className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                                      >
                                        {start.toLocaleDateString(undefined, {
                                          weekday: "short",
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                        })}{" "}
                                        ·{" "}
                                        {start.toLocaleTimeString(undefined, {
                                          hour: "numeric",
                                          minute: "2-digit",
                                        })}
                                      </Link>
                                      <Badge variant="secondary" className="capitalize">
                                        {r.status.replace(/_/g, " ")}
                                      </Badge>
                                    </li>
                                  );
                                })}
                              </ul>
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
        </Card>
    </>
  );
}

export default function StandingReservations() {
  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <StandingReservationsSection />
      </div>
    </PortalLayout>
  );
}
