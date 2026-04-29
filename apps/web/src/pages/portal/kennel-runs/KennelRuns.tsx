import { useMemo, useState } from "react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import ModuleGate from "@/components/portal/facility/ModuleGate";
import LocationFilter from "@/components/portal/facility/LocationFilter";
import StatusBadge from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Pencil, Plus, X, DoorClosed } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useLocations";
import { toast } from "sonner";
import { formatCentsShort } from "@/lib/money";
import KennelRunFormDialog, { KennelRunRow } from "./KennelRunFormDialog";

const RUN_TONES: Record<KennelRunRow["run_type"], "muted" | "primary" | "plum" | "success" | "warning"> = {
  standard: "muted",
  large: "primary",
  suite: "plum",
  indoor: "success",
  outdoor: "warning",
};

function KennelRunsInner() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KennelRunRow | null>(null);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["kennel-runs", orgId, locationFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("kennel_runs")
        .select("id, name, run_type, capacity, daily_rate_modifier_cents, active, location_id")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (locationFilter !== "all") q = q.eq("location_id", locationFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as KennelRunRow[];
    },
  });

  // Boarding check-ins (for unassigned list + occupant lookup)
  const { data: boardingCheckIns = [] } = useQuery({
    queryKey: ["kennel-checkins", orgId, locationFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("reservations")
        .select(
          "id, location_id, start_at, end_at, services!inner(module), reservation_pets(pet_id, pets(id, name)), owners:primary_owner_id(first_name, last_name)"
        )
        .eq("organization_id", orgId!)
        .eq("status", "checked_in")
        .is("deleted_at", null)
        .eq("services.module", "boarding");
      if (locationFilter !== "all") q = q.eq("location_id", locationFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Active assignments
  const { data: assignments = [] } = useQuery({
    queryKey: ["kennel-run-assignments", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kennel_run_assignments")
        .select("id, kennel_run_id, pet_id, reservation_id, pets(name)")
        .eq("organization_id", orgId!)
        .is("removed_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Build pets-on-floor list
  const boardingPets = useMemo(() => {
    const list: Array<{
      petId: string;
      name: string;
      ownerName: string;
      reservationId: string;
      dates: string;
    }> = [];
    for (const r of boardingCheckIns as any[]) {
      const ownerName = r.owners
        ? `${r.owners.first_name ?? ""} ${r.owners.last_name ?? ""}`.trim()
        : "—";
      const start = new Date(r.start_at).toLocaleDateString();
      const end = new Date(r.end_at).toLocaleDateString();
      for (const rp of r.reservation_pets ?? []) {
        if (rp.pets) {
          list.push({
            petId: rp.pet_id,
            name: rp.pets.name,
            ownerName,
            reservationId: r.id,
            dates: `${start} – ${end}`,
          });
        }
      }
    }
    return list;
  }, [boardingCheckIns]);

  // run_id -> assignment record
  const occupantByRun = useMemo(() => {
    const m = new Map<string, { assignmentId: string; petName: string; petId: string }>();
    for (const a of assignments as any[]) {
      m.set(a.kennel_run_id, {
        assignmentId: a.id,
        petName: a.pets?.name ?? "Pet",
        petId: a.pet_id,
      });
    }
    return m;
  }, [assignments]);

  const assignedPetIds = useMemo(
    () => new Set(assignments.map((a: any) => a.pet_id)),
    [assignments],
  );
  const unassigned = boardingPets.filter((p) => !assignedPetIds.has(p.petId));

  const occupiedRunIds = useMemo(
    () => new Set(assignments.map((a: any) => a.kennel_run_id)),
    [assignments],
  );

  const toggleActive = useMutation({
    mutationFn: async (run: KennelRunRow) => {
      const { error } = await supabase
        .from("kennel_runs")
        .update({ active: !run.active })
        .eq("id", run.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kennel-runs"] });
      toast.success("Kennel run updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async ({
      petId,
      reservationId,
      runId,
    }: {
      petId: string;
      reservationId: string;
      runId: string;
    }) => {
      const { error } = await supabase.from("kennel_run_assignments").insert({
        organization_id: orgId!,
        pet_id: petId,
        reservation_id: reservationId,
        kennel_run_id: runId,
        assigned_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["kennel-run-assignments"] });
      const r = runs.find((x) => x.id === vars.runId);
      const p = boardingPets.find((x) => x.petId === vars.petId);
      toast.success(`${p?.name ?? "Pet"} assigned to ${r?.name ?? "run"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("kennel_run_assignments")
        .update({ removed_at: new Date().toISOString() })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kennel-run-assignments"] });
      toast.success("Pet removed from run");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const vacantActiveRuns = runs.filter((r) => r.active && !occupiedRunIds.has(r.id));

  return (
    <>
    <div className="px-8 py-6">
        <PageHeader
          title="Kennel Runs"
          description="Manage your boarding kennels and suites"
          actions={
            <div className="flex items-center gap-2">
              <LocationFilter
                locations={locations}
                value={locationFilter}
                onChange={setLocationFilter}
              />
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add kennel run
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="h-48 animate-pulse rounded-lg bg-surface" />
        ) : runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <DoorClosed className="mx-auto h-10 w-10 text-text-tertiary" />
            <div className="mt-3 font-display text-lg">No kennel runs yet</div>
            <p className="mt-1 text-sm text-text-secondary">
              Add your first kennel run or suite to start assigning boarding guests.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add kennel run
            </Button>
          </div>
        ) : (
          <Card className="border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rate modifier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current occupant</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const occupant = occupantByRun.get(r.id);
                  return (
                    <TableRow key={r.id} className={!r.active ? "opacity-60" : ""}>
                      <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                      <TableCell>
                        <StatusBadge tone={RUN_TONES[r.run_type]}>
                          {r.run_type.charAt(0).toUpperCase() + r.run_type.slice(1)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.daily_rate_modifier_cents > 0
                          ? `+${formatCentsShort(r.daily_rate_modifier_cents)}/night`
                          : <span className="text-text-tertiary">Base rate</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={r.active ? "success" : "muted"}>
                          {r.active ? "Active" : "Inactive"}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {occupant ? (
                          <span className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2 py-0.5 text-xs">
                            {occupant.petName}
                            <button
                              onClick={() => unassign.mutate(occupant.assignmentId)}
                              className="text-text-tertiary hover:text-destructive"
                              aria-label={`Remove ${occupant.petName}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ) : (
                          <span className="text-text-tertiary">Vacant</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2"
                          onClick={() => toggleActive.mutate(r)}
                        >
                          {r.active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        {unassigned.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg text-foreground">Assign boarding pets</h2>
            <Card className="border-border bg-card">
              <div className="divide-y divide-border-subtle">
                {unassigned.map((p) => (
                  <div
                    key={`${p.petId}-${p.reservationId}`}
                    className="flex items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{p.name}</div>
                      <div className="text-xs text-text-secondary">
                        {p.ownerName} · {p.dates}
                      </div>
                    </div>
                    <Select
                      onValueChange={(runId) =>
                        assign.mutate({
                          petId: p.petId,
                          reservationId: p.reservationId,
                          runId,
                        })
                      }
                      disabled={vacantActiveRuns.length === 0}
                    >
                      <SelectTrigger className="w-[220px] bg-surface">
                        <SelectValue
                          placeholder={
                            vacantActiveRuns.length === 0 ? "No vacant runs" : "Assign to..."
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {vacantActiveRuns.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} ({r.run_type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      <KennelRunFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        run={editing}
        defaultLocationId={locationFilter !== "all" ? locationFilter : null}
      />
    </>
  );
}

export function KennelRunsSection() {
  return (
    <ModuleGate
      module="boarding"
      title="Kennel Runs"
      description="Manage your boarding kennels and suites"
    >
      <KennelRunsInner />
    </ModuleGate>
  );
}

export default function KennelRuns() {
  return (
    <PortalLayout>
      <KennelRunsSection />
    </PortalLayout>
  );
}
