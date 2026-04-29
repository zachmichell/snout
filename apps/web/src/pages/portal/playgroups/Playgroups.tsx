import { useMemo, useState } from "react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
// PlaygroupsSection: body-only (no PortalLayout) for embedding inside Settings tabs.
import ModuleGate from "@/components/portal/facility/ModuleGate";
import LocationFilter from "@/components/portal/facility/LocationFilter";
import StatusBadge from "@/components/portal/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, X, Users2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useLocations";
import { toast } from "sonner";
import PlaygroupFormDialog, { PlaygroupRow } from "./PlaygroupFormDialog";

function PlaygroupsInner() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlaygroupRow | null>(null);

  // Playgroups
  const { data: playgroups = [], isLoading } = useQuery({
    queryKey: ["playgroups", orgId, locationFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("playgroups")
        .select("id, name, capacity, color, active, location_id")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (locationFilter !== "all") q = q.eq("location_id", locationFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PlaygroupRow[];
    },
  });

  // Today's checked-in daycare reservations + their pets
  const { data: dayCheckIns = [] } = useQuery({
    queryKey: ["playgroups-checkins", orgId, locationFilter],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("reservations")
        .select(
          "id, location_id, primary_owner_id, services!inner(module), reservation_pets(pet_id, pets(id, name)), owners:primary_owner_id(first_name, last_name)"
        )
        .eq("organization_id", orgId!)
        .eq("status", "checked_in")
        .is("deleted_at", null)
        .eq("services.module", "daycare");
      if (locationFilter !== "all") q = q.eq("location_id", locationFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Today's playgroup assignments
  const { data: assignments = [] } = useQuery({
    queryKey: ["playgroup-assignments", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("playgroup_assignments")
        .select("id, playgroup_id, pet_id, reservation_id, assigned_at, removed_at, pets(name)")
        .eq("organization_id", orgId!)
        .is("removed_at", null)
        .gte("assigned_at", startOfDay.toISOString());
      if (error) throw error;
      return data ?? [];
    },
  });

  // Build pets-on-floor list (pet_id -> { name, ownerName, reservationId })
  const petsOnFloor = useMemo(() => {
    const list: Array<{
      petId: string;
      name: string;
      ownerName: string;
      reservationId: string;
    }> = [];
    for (const r of dayCheckIns as any[]) {
      const ownerName = r.owners
        ? `${r.owners.first_name ?? ""} ${r.owners.last_name ?? ""}`.trim()
        : "—";
      for (const rp of r.reservation_pets ?? []) {
        if (rp.pets) {
          list.push({
            petId: rp.pet_id,
            name: rp.pets.name,
            ownerName,
            reservationId: r.id,
          });
        }
      }
    }
    return list;
  }, [dayCheckIns]);

  const assignedPetIds = useMemo(
    () => new Set(assignments.map((a: any) => a.pet_id)),
    [assignments],
  );
  const unassigned = petsOnFloor.filter((p) => !assignedPetIds.has(p.petId));

  const playgroupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) {
      m.set(a.playgroup_id, (m.get(a.playgroup_id) ?? 0) + 1);
    }
    return m;
  }, [assignments]);

  const playgroupPets = useMemo(() => {
    const m = new Map<string, Array<{ assignmentId: string; petName: string }>>();
    for (const a of assignments as any[]) {
      const arr = m.get(a.playgroup_id) ?? [];
      arr.push({ assignmentId: a.id, petName: a.pets?.name ?? "Pet" });
      m.set(a.playgroup_id, arr);
    }
    return m;
  }, [assignments]);

  const toggleActive = useMutation({
    mutationFn: async (pg: PlaygroupRow) => {
      const { error } = await supabase
        .from("playgroups")
        .update({ active: !pg.active })
        .eq("id", pg.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playgroups"] });
      toast.success("Playgroup updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async ({
      petId,
      reservationId,
      playgroupId,
    }: {
      petId: string;
      reservationId: string;
      playgroupId: string;
    }) => {
      const { error } = await supabase.from("playgroup_assignments").insert({
        organization_id: orgId!,
        pet_id: petId,
        reservation_id: reservationId,
        playgroup_id: playgroupId,
        assigned_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["playgroup-assignments"] });
      const pg = playgroups.find((p) => p.id === vars.playgroupId);
      const pet = petsOnFloor.find((p) => p.petId === vars.petId);
      toast.success(`${pet?.name ?? "Pet"} assigned to ${pg?.name ?? "playgroup"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("playgroup_assignments")
        .update({ removed_at: new Date().toISOString() })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playgroup-assignments"] });
      toast.success("Pet removed from playgroup");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activePlaygroups = playgroups.filter((p) => p.active);

  return (
    <div className="px-8 py-6">
        <PageHeader
          title="Playgroups"
          description="Manage your daycare play areas"
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
                <Plus className="h-4 w-4" /> Add playgroup
              </Button>
            </div>
          }
        />

        {/* Playgroup cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        ) : playgroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-12 text-center shadow-card">
            <Users2 className="mx-auto h-10 w-10 text-text-tertiary" />
            <div className="mt-3 font-display text-lg">No playgroups yet</div>
            <p className="mt-1 text-sm text-text-secondary">
              Create your first playgroup to start grouping daycare pets.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add playgroup
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {playgroups.map((pg) => {
              const count = playgroupCounts.get(pg.id) ?? 0;
              const cap = pg.capacity ?? 0;
              const pets = playgroupPets.get(pg.id) ?? [];
              return (
                <Card
                  key={pg.id}
                  className={`overflow-hidden border-border bg-card ${
                    !pg.active ? "opacity-60" : ""
                  }`}
                >
                  <div className="h-2" style={{ backgroundColor: pg.color }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-base text-foreground">{pg.name}</h3>
                        <div className="mt-1 text-xs text-text-secondary">
                          Capacity: {count} / {cap}
                        </div>
                      </div>
                      <StatusBadge tone={pg.active ? "success" : "muted"}>
                        {pg.active ? "Active" : "Inactive"}
                      </StatusBadge>
                    </div>

                    <div className="mt-4">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                        Pets today
                      </div>
                      {pets.length === 0 ? (
                        <p className="mt-1 text-sm text-text-tertiary">No pets assigned</p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {pets.map((p) => (
                            <li
                              key={p.assignmentId}
                              className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2 py-0.5 text-xs"
                            >
                              {p.petName}
                              <button
                                onClick={() => unassign.mutate(p.assignmentId)}
                                className="text-text-tertiary hover:text-destructive"
                                aria-label={`Remove ${p.petName}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(pg);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive.mutate(pg)}
                      >
                        {pg.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Assign Pets panel */}
        {unassigned.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg text-foreground">Assign pets</h2>
            <Card className="border-border bg-card">
              <div className="divide-y divide-border-subtle">
                {unassigned.map((p) => (
                  <div
                    key={`${p.petId}-${p.reservationId}`}
                    className="flex items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{p.name}</div>
                      <div className="text-xs text-text-secondary">{p.ownerName}</div>
                    </div>
                    <Select
                      onValueChange={(playgroupId) =>
                        assign.mutate({
                          petId: p.petId,
                          reservationId: p.reservationId,
                          playgroupId,
                        })
                      }
                    >
                      <SelectTrigger className="w-[200px] bg-surface">
                        <SelectValue placeholder="Assign to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activePlaygroups.map((pg) => {
                          const count = playgroupCounts.get(pg.id) ?? 0;
                          const cap = pg.capacity ?? 0;
                          const full = cap > 0 && count >= cap;
                          return (
                            <SelectItem key={pg.id} value={pg.id} disabled={full}>
                              {pg.name} ({count}/{cap}){full ? " — full" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

      <PlaygroupFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        playgroup={editing}
        defaultLocationId={locationFilter !== "all" ? locationFilter : null}
      />
    </div>
  );
}

export function PlaygroupsSection() {
  return (
    <ModuleGate
      module="daycare"
      title="Playgroups"
      description="Manage your daycare play areas"
    >
      <PlaygroupsInner />
    </ModuleGate>
  );
}

export default function Playgroups() {
  return (
    <PortalLayout>
      <PlaygroupsSection />
    </PortalLayout>
  );
}
