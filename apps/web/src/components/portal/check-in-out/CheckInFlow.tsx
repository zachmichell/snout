import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgModules } from "@/hooks/useOrgModules";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCheckIn } from "@/hooks/useCheckInOut";
import { validateVaccinations, validateWaivers, vaxOverallStatus, waiverOverallStatus } from "@/lib/checkin";
import { VaxBadge, WaiverBadge, WaiverList } from "./WaiverVaxBadges";
import { formatVaccineType } from "@/lib/format";

export type CheckInPet = {
  id: string;
  name: string;
  species: string | null;
  vaccinations: { vaccine_type: string; expires_on: string | null }[];
};

type Props = {
  reservationId: string;
  ownerId: string | null;
  pets: CheckInPet[];
  serviceModule: string | null;
  locationId: string | null;
  onDone?: () => void;
  onCancel?: () => void;
};

type Step = "validate" | "assign" | "confirm";

export default function CheckInFlow({
  reservationId,
  ownerId,
  pets,
  serviceModule,
  locationId,
  onDone,
  onCancel,
}: Props) {
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? null;
  const { data: modules } = useOrgModules();
  const [step, setStep] = useState<Step>("validate");
  const [override, setOverride] = useState(false);
  const [playgroupId, setPlaygroupId] = useState<string>("");
  const [kennelRunId, setKennelRunId] = useState<string>("");
  const [dropoffOwnerId, setDropoffOwnerId] = useState<string>(ownerId ?? "");
  const checkIn = useCheckIn();

  // All owners linked to the first pet (so staff can pick who is dropping off)
  const firstPetId = pets[0]?.id ?? null;
  const { data: petLinkedOwners } = useQuery({
    queryKey: ["checkin-pet-owners", firstPetId],
    enabled: !!firstPetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("role, owner:owners(id, first_name, last_name, phone)")
        .eq("pet_id", firstPetId!)
        .order("role", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => r.owner);
    },
  });

  // Waivers + signatures (single owner)
  const { data: waiverStatus } = useQuery({
    queryKey: ["checkin-waivers", orgId, ownerId],
    enabled: !!orgId && !!ownerId,
    queryFn: async () => {
      const [{ data: waivers }, { data: sigs }] = await Promise.all([
        supabase
          .from("waivers")
          .select("id, title, version")
          .eq("organization_id", orgId!)
          .eq("active", true)
          .is("deleted_at", null),
        supabase
          .from("waiver_signatures")
          .select("waiver_id, waiver_version")
          .eq("owner_id", ownerId!),
      ]);
      return validateWaivers(waivers ?? [], sigs ?? []);
    },
  });

  // Assignment options
  const showPlaygroup = serviceModule === "daycare" && (modules?.has("daycare") ?? true);
  const showKennel = serviceModule === "boarding" && (modules?.has("boarding") ?? true);

  // Enclosure memory: surface where this pet was last assigned so staff
  // can put them in the same space without scrolling. Pre-fills the
  // dropdown the first time the data arrives, only if staff has not
  // already chosen one.
  const { data: lastPlaygroup } = useQuery({
    queryKey: ["last-playgroup-for-pet", firstPetId],
    enabled: !!firstPetId && showPlaygroup,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playgroup_assignments")
        .select("playgroup_id, assigned_at, playgroup:playgroups(name)")
        .eq("pet_id", firstPetId!)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lastKennelRun } = useQuery({
    queryKey: ["last-kennel-run-for-pet", firstPetId],
    enabled: !!firstPetId && showKennel,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kennel_run_assignments")
        .select("kennel_run_id, assigned_at, kennel_run:kennel_runs(name)")
        .eq("pet_id", firstPetId!)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!showPlaygroup) return;
    if (playgroupId) return;
    if (lastPlaygroup?.playgroup_id) setPlaygroupId(lastPlaygroup.playgroup_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPlaygroup?.playgroup_id, showPlaygroup]);

  useEffect(() => {
    if (!showKennel) return;
    if (kennelRunId) return;
    if (lastKennelRun?.kennel_run_id) setKennelRunId(lastKennelRun.kennel_run_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKennelRun?.kennel_run_id, showKennel]);

  const { data: playgroups } = useQuery({
    queryKey: ["checkin-playgroups", orgId, locationId],
    enabled: showPlaygroup && !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("playgroups")
        .select("id, name, color")
        .eq("organization_id", orgId!)
        .eq("active", true)
        .is("deleted_at", null);
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q.order("name");
      return data ?? [];
    },
  });

  const { data: kennelRuns } = useQuery({
    queryKey: ["checkin-kennels", orgId, locationId],
    enabled: showKennel && !!orgId,
    queryFn: async () => {
      let q = supabase
        .from("kennel_runs")
        .select(
          `id, name, capacity,
           kennel_run_assignments!inner(id, removed_at, reservation:reservations!kennel_run_assignments_reservation_id_fkey(status))`,
        )
        .eq("organization_id", orgId!)
        .eq("active", true)
        .is("deleted_at", null);
      if (locationId) q = q.eq("location_id", locationId);
      const { data: rows } = await q.order("name");

      // Also fetch all runs even without active assignments (left join workaround)
      let q2 = supabase
        .from("kennel_runs")
        .select("id, name, capacity")
        .eq("organization_id", orgId!)
        .eq("active", true)
        .is("deleted_at", null);
      if (locationId) q2 = q2.eq("location_id", locationId);
      const { data: allRuns } = await q2.order("name");

      const occupiedCount = new Map<string, number>();
      for (const r of rows ?? []) {
        const active = (r as any).kennel_run_assignments?.filter(
          (a: any) => !a.removed_at && a.reservation?.status === "checked_in",
        ).length ?? 0;
        occupiedCount.set(r.id, active);
      }
      return (allRuns ?? []).map((r) => ({
        ...r,
        occupied: occupiedCount.get(r.id) ?? 0,
      }));
    },
  });

  // Build per-pet vax checks
  const petChecks = pets.map((p) => ({
    pet: p,
    checks: validateVaccinations(p.species, p.vaccinations),
  }));
  const worstVax = vaxOverallStatus(petChecks.flatMap((p) => p.checks));
  const worstWaiver = waiverStatus ? waiverOverallStatus(waiverStatus) : "signed";
  const allClear = worstVax === "current" && worstWaiver === "signed";

  const proceed = () => setStep(serviceModule ? "assign" : "confirm");

  const submit = () => {
    const firstPet = pets[0];
    let assignment = null;
    if (showPlaygroup && playgroupId && firstPet) {
      assignment = { kind: "playgroup" as const, playgroup_id: playgroupId, pet_id: firstPet.id };
    } else if (showKennel && kennelRunId && firstPet) {
      assignment = { kind: "kennel" as const, kennel_run_id: kennelRunId, pet_id: firstPet.id };
    }
    checkIn.mutate(
      { reservationId, petName: firstPet?.name, assignment },
      { onSuccess: () => onDone?.() },
    );
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-card-alt p-4 text-sm">
      {/* Stepper */}
      <ol className="mb-4 flex items-center gap-2 text-xs font-semibold text-text-tertiary">
        <StepLabel n={1} label="Validate" active={step === "validate"} done={step !== "validate"} />
        <ChevronRight className="h-3 w-3" />
        <StepLabel n={2} label="Assign" active={step === "assign"} done={step === "confirm"} />
        <ChevronRight className="h-3 w-3" />
        <StepLabel n={3} label="Confirm" active={step === "confirm"} done={false} />
      </ol>

      {step === "validate" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <WaiverBadge status={worstWaiver} />
            <VaxBadge status={worstVax} />
          </div>

          {petLinkedOwners && petLinkedOwners.length > 1 && (
            <div>
              <label className="label-eyebrow mb-2 block">Drop-off contact</label>
              <Select value={dropoffOwnerId} onValueChange={setDropoffOwnerId}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose owner…" />
                </SelectTrigger>
                <SelectContent>
                  {petLinkedOwners.map((row: any) => (
                    <SelectItem key={row.owner.id} value={row.owner.id}>
                      {row.owner.first_name} {row.owner.last_name}
                      {row.owner.phone ? ` · ${row.owner.phone}` : ""}
                      {row.role === "primary" ? " · Primary" : " · Co-owner"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="label-eyebrow mb-2">Waivers</div>
              <WaiverList items={waiverStatus ?? []} />
            </div>
            <div>
              <div className="label-eyebrow mb-2">Vaccinations</div>
              <ul className="space-y-1.5">
                {petChecks.map(({ pet, checks }) => (
                  <li key={pet.id}>
                    <div className="text-xs font-semibold text-foreground">{pet.name}</div>
                    <ul className="ml-2 mt-1 space-y-0.5">
                      {checks.length === 0 ? (
                        <li className="text-xs text-text-tertiary">No vaccinations on file.</li>
                      ) : (
                        checks.map((c, i) => (
                          <li
                            key={`${c.type}-${i}`}
                            className={`text-xs ${
                              c.status === "current"
                                ? "text-success"
                                : c.status === "expiring"
                                  ? "text-warning"
                                  : c.status === "missing"
                                    ? "text-warning"
                                    : "text-destructive"
                            }`}
                          >
                            {c.status === "current" && "✓ "}
                            {c.status === "expiring" && "⚠ "}
                            {c.status === "missing" && "⚠ "}
                            {c.status === "expired" && "✗ "}
                            {formatVaccineType(c.type)}{" "}
                            {c.status === "missing"
                              ? "missing"
                              : c.status === "expired"
                                ? `expired ${c.expires_on}`
                                : c.status === "expiring"
                                  ? `expires ${c.expires_on}`
                                  : `current to ${c.expires_on}`}
                          </li>
                        ))
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {allClear ? (
            <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success-light px-3 py-2 text-success">
              <CheckCircle2 className="h-4 w-4" /> Ready to check in
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning-light px-3 py-2 text-warning">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Some items need attention
              </div>
              <button
                onClick={() => setOverride(true)}
                className="text-xs font-semibold text-text-secondary underline hover:text-foreground"
              >
                Check in anyway
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={proceed} disabled={!allClear && !override}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "assign" && (
        <div className="space-y-4">
          {showPlaygroup && (
            <div>
              <label className="label-eyebrow mb-2 block">Playgroup</label>
              <Select value={playgroupId} onValueChange={setPlaygroupId}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose a playgroup…" />
                </SelectTrigger>
                <SelectContent>
                  {(playgroups ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {showKennel && (
            <div>
              <label className="label-eyebrow mb-2 block">Kennel run</label>
              <Select value={kennelRunId} onValueChange={setKennelRunId}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Choose a kennel run…" />
                </SelectTrigger>
                <SelectContent>
                  {(kennelRuns ?? []).map((k: any) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name} · {k.occupied}/{k.capacity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!showPlaygroup && !showKennel && (
            <p className="text-xs text-text-tertiary">No assignment needed for this service.</p>
          )}
          <div className="flex justify-between">
            <button
              onClick={() => setStep("confirm")}
              className="text-xs font-semibold text-text-secondary underline hover:text-foreground"
            >
              Skip — assign later
            </button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("validate")}>
                Back
              </Button>
              <Button size="sm" onClick={() => setStep("confirm")}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <p className="text-foreground">
            Check in <span className="font-semibold">{pets.map((p) => p.name).join(", ")}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep(serviceModule ? "assign" : "validate")}>
              Back
            </Button>
            <Button size="sm" onClick={submit} disabled={checkIn.isPending}>
              {checkIn.isPending ? "Checking in…" : "Confirm check-in"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepLabel({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
        active ? "bg-primary text-primary-foreground" : done ? "text-success" : ""
      }`}
    >
      <span className="font-bold">{done ? "✓" : n}</span>
      <span>{label}</span>
    </span>
  );
}
