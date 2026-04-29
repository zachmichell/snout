import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { calcAge, formatDate, formatVaccineType, kgToLbs } from "@/lib/format";
import { lbsToKg } from "@/lib/vaccines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PetPhotoUpload from "@/components/portal-owner/PetPhotoUpload";
import VaccinationFormDialog from "@/components/portal-owner/VaccinationFormDialog";
import PetTraitsOwnerSection from "@/components/portal-owner/PetTraitsOwnerSection";
import PetIncidentsOwnerSection from "@/components/portal-owner/PetIncidentsOwnerSection";
import { usePetMedications } from "@/hooks/usePetMedications";
import { usePetFeeding } from "@/hooks/usePetFeeding";
import VaccinationStatusBadge, {
  vaccinationRecordStatus,
} from "@/components/portal-owner/VaccinationStatusBadge";
import {
  extensionFromPath,
  slugifyForFilename,
  withDownloadFilename,
} from "@/lib/storage-download";

function extractStoragePath(url: string | null): string | null {
  if (!url) return null;
  if (!url.startsWith("http")) return url; // already a path
  const m = url.match(/\/vaccination-docs\/(.+)$/);
  return m ? m[1].split("?")[0] : null;
}

function VaxDocLink({
  value,
  filenameHint,
}: {
  value: string | null;
  filenameHint?: { petName?: string | null; vaccineType?: string | null; administeredOn?: string | null };
}) {
  const [busy, setBusy] = useState(false);
  if (!value) return <span className="text-xs text-muted-foreground">No document uploaded</span>;

  // Build a meaningful filename so a saved doc lands in the user's
  // Files / Downloads folder as something they can recognize months
  // later when their vet asks for it.
  const filename = (() => {
    const parts: string[] = [];
    if (filenameHint?.petName) parts.push(slugifyForFilename(filenameHint.petName));
    if (filenameHint?.vaccineType) parts.push(slugifyForFilename(filenameHint.vaccineType));
    if (filenameHint?.administeredOn) parts.push(filenameHint.administeredOn);
    if (parts.length === 0) parts.push("vaccination-document");
    const ext = extensionFromPath(value, "pdf");
    return `${parts.join("-")}.${ext}`;
  })();

  const openInline = async () => {
    const path = extractStoragePath(value);
    if (!path) return;
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("vaccination-docs")
      .createSignedUrl(path, 60);
    setBusy(false);
    if (error || !data?.signedUrl) {
      toast.error("Could not open document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadDoc = async () => {
    const path = extractStoragePath(value);
    if (!path) return;
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("vaccination-docs")
      .createSignedUrl(path, 60);
    setBusy(false);
    if (error || !data?.signedUrl) {
      toast.error("Could not download document");
      return;
    }
    // Use a synthetic anchor so we can carry both the forced filename
    // (via the URL's download param) AND the HTML download attribute,
    // for browsers that respect the latter on cross-origin URLs only
    // when paired with the former.
    const url = withDownloadFilename(data.signedUrl, filename);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={openInline}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-hover hover:underline"
      >
        <FileText className="h-3.5 w-3.5" /> {busy ? "Opening…" : "View"}
      </button>
      <button
        type="button"
        onClick={downloadDoc}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-hover hover:underline"
        aria-label={`Download ${filename}`}
      >
        Download
      </button>
    </span>
  );
}

export default function OwnerPetDetail() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useAuth();
  const { data: owner, isLoading: ownerLoading } = useOwnerRecord();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<any | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");

  // Editable fields local state
  const [dob, setDob] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [color, setColor] = useState("");
  const [markings, setMarkings] = useState("");
  const [microchip, setMicrochip] = useState("");

  const { data: pet, isLoading } = useQuery({
    queryKey: ["owner-pet", id, owner?.id],
    enabled: !!id && !!owner?.id,
    queryFn: async () => {
      const { data: link } = await supabase
        .from("pet_owners")
        .select("pet_id")
        .eq("pet_id", id!)
        .eq("owner_id", owner!.id)
        .maybeSingle();
      if (!link) return null;
      const { data, error } = await supabase
        .from("pets")
        .select("*")
        .eq("id", id!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (pet) {
      setDob(pet.date_of_birth ?? "");
      setWeightLbs(pet.weight_kg ? String(kgToLbs(pet.weight_kg)) : "");
      setColor(pet.color ?? "");
      setMarkings(pet.markings ?? "");
      setMicrochip(pet.microchip_id ?? "");
    }
  }, [pet]);

  useEffect(() => {
    if (!membership?.organization_id) return;
    supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle()
      .then(({ data }) => setOrgName(data?.name ?? ""));
  }, [membership?.organization_id]);

  const { data: vaccinations } = useQuery({
    queryKey: ["pet-vaccinations", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vaccinations")
        .select("*")
        .eq("pet_id", id!)
        .is("deleted_at", null)
        .order("expires_on", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveDetails = useMutation({
    mutationFn: async () => {
      const payload = {
        date_of_birth: dob || null,
        weight_kg: lbsToKg(weightLbs),
        color: color || null,
        markings: markings || null,
        microchip_id: microchip || null,
      };
      const { error } = await supabase.from("pets").update(payload).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pet profile updated");
      qc.invalidateQueries({ queryKey: ["owner-pet", id] });
      qc.invalidateQueries({ queryKey: ["owner-pets-full"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const deleteVax = useMutation({
    mutationFn: async (vaxId: string) => {
      const v = vaccinations?.find((x: any) => x.id === vaxId);
      const path = extractStoragePath(v?.document_url ?? null);
      if (path) {
        await supabase.storage.from("vaccination-docs").remove([path]);
      }
      const { error } = await supabase.from("vaccinations").delete().eq("id", vaxId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Record deleted");
      qc.invalidateQueries({ queryKey: ["pet-vaccinations", id] });
      qc.invalidateQueries({ queryKey: ["owner-pets-full"] });
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  if (!ownerLoading && !owner) return <Navigate to="/portal/pets" replace />;
  if (!isLoading && pet === null) return <Navigate to="/portal/pets" replace />;

  if (isLoading || !pet) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const sexLabel = pet.sex === "M" ? "Male" : pet.sex === "F" ? "Female" : "Unknown";
  const tags: string[] = pet.temperament_tags ?? [];

  return (
    <div className="space-y-6">
      <Link
        to="/portal/pets"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to pets
      </Link>

      {/* Pet info card */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-start gap-6 sm:flex-row">
          <PetPhotoUpload
            petId={pet.id}
            organizationId={pet.organization_id}
            species={pet.species}
            photoUrl={pet.photo_url}
            onUploaded={() => qc.invalidateQueries({ queryKey: ["owner-pet", id] })}
          />
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
              {pet.name}
            </h1>
            <p className="mt-1 text-muted-foreground capitalize">
              {pet.breed ?? "Mixed"} · {pet.species}
            </p>
            <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Sex:</dt>
                <dd className="text-foreground">{sexLabel}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Spayed/Neutered:</dt>
                <dd className="text-foreground">
                  {pet.spayed_neutered === true
                    ? "Yes"
                    : pet.spayed_neutered === false
                      ? "No"
                      : "—"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Age:</dt>
                <dd className="text-foreground">{calcAge(pet.date_of_birth) ?? "Unknown"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Editable details card */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="font-display text-xl font-semibold text-foreground">Details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your pet's physical details and microchip information.
        </p>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveDetails.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="dob">Birthdate</Label>
            <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weight">Weight (lbs)</Label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              min="0"
              value={weightLbs}
              onChange={(e) => setWeightLbs(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="color">Color</Label>
            <Input id="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="markings">Markings</Label>
            <Input
              id="markings"
              value={markings}
              onChange={(e) => setMarkings(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chip">Microchip number</Label>
            <Input
              id="chip"
              value={microchip}
              onChange={(e) => setMicrochip(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={saveDetails.isPending}>
              {saveDetails.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </form>
      </section>

      {/* Behavior & notes (read-only) */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="font-display text-xl font-semibold text-foreground">Behavior & notes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These notes are managed by {orgName || "the staff"}.
        </p>
        <dl className="mt-5 space-y-4 text-sm">
          <NoteRow label="Behavior notes" value={pet.behavioral_notes} />
          <NoteRow label="Feeding notes" value={pet.feeding_notes} />
          <NoteRow label="Medication notes" value={pet.medication_notes} />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Temperament tags
            </dt>
            <dd className="mt-1.5">
              {tags.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Traits & behavior (read-only, from pet_traits) */}
      <PetTraitsOwnerSection petId={pet.id} petName={pet.name} orgName={orgName} />

      {/* Medications (read-only) */}
      <MedicationsSection petId={pet.id} orgName={orgName} />

      {/* Feeding (read-only) */}
      <FeedingSection petId={pet.id} orgName={orgName} />

      {/* Incident history (owner-visible only) */}
      <PetIncidentsOwnerSection petId={pet.id} petName={pet.name} />

      {/* Vaccinations */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Vaccination records
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload vet records — staff will verify them.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add record
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {(!vaccinations || vaccinations.length === 0) && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No vaccination records yet.
            </p>
          )}
          {vaccinations?.map((v: any) => {
            const status = vaccinationRecordStatus(v.expires_on);
            return (
              <article
                key={v.id}
                className="rounded-xl border border-border-subtle bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">
                        {formatVaccineType(v.vaccine_type)}
                      </h3>
                      <VaccinationStatusBadge
                        status={status === "current" ? "current" : status === "expiring" ? "expiring" : "expired"}
                      />
                      {v.verified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3 w-3" /> Verified by staff
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          Pending verification
                        </span>
                      )}
                    </div>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Administered:</dt>
                        <dd className="text-foreground">{formatDate(v.administered_on)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Expires:</dt>
                        <dd className="text-foreground">{formatDate(v.expires_on)}</dd>
                      </div>
                      {(v.vet_name || v.vet_clinic) && (
                        <div className="flex gap-2 sm:col-span-2">
                          <dt className="text-muted-foreground">Vet:</dt>
                          <dd className="text-foreground">
                            {[v.vet_name, v.vet_clinic].filter(Boolean).join(" · ")}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-2">
                      <VaxDocLink
                        value={v.document_url}
                        filenameHint={{
                          petName: pet?.name,
                          vaccineType: formatVaccineType(v.vaccine_type),
                          administeredOn: v.administered_on,
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(v);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(v.id)}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <VaccinationFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        petId={pet.id}
        organizationId={pet.organization_id}
        existing={editing}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vaccination record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the record and any uploaded document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteVax.mutate(deleteId)}
              className="bg-danger hover:bg-danger/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NoteRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap text-foreground">
        {value || <span className="text-muted-foreground">No notes</span>}
      </dd>
    </div>
  );
}

function MedicationsSection({ petId, orgName }: { petId: string; orgName: string }) {
  const { data: meds } = usePetMedications(petId);
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-xl font-semibold text-foreground">Medications</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Managed by {orgName || "your provider"}. Contact them to request changes.
      </p>
      <div className="mt-5 space-y-3">
        {(!meds || meds.length === 0) ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No medications on file.
          </p>
        ) : (
          meds.map((m: any) => (
            <article key={m.id} className="rounded-xl border border-border-subtle bg-background p-4">
              <h3 className="font-semibold text-foreground">{m.name}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {m.dosage && <Row label="Dosage" value={m.dosage} />}
                {m.frequency && <Row label="Frequency" value={m.frequency} />}
                {m.timing && <Row label="Timing" value={m.timing} />}
              </dl>
              {m.instructions && <p className="mt-2 text-sm text-muted-foreground">{m.instructions}</p>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function FeedingSection({ petId, orgName }: { petId: string; orgName: string }) {
  const { data: schedules } = usePetFeeding(petId);
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-xl font-semibold text-foreground">Feeding schedule</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Managed by {orgName || "your provider"}. Contact them to request changes.
      </p>
      <div className="mt-5 space-y-3">
        {(!schedules || schedules.length === 0) ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No feeding schedule on file.
          </p>
        ) : (
          schedules.map((s: any) => (
            <article key={s.id} className="rounded-xl border border-border-subtle bg-background p-4">
              <h3 className="font-semibold text-foreground">{s.food_type}</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {s.amount && <Row label="Amount" value={s.amount} />}
                {s.frequency && <Row label="Frequency" value={s.frequency} />}
                {s.timing && <Row label="Timing" value={s.timing} />}
              </dl>
              {s.instructions && <p className="mt-2 text-sm text-muted-foreground">{s.instructions}</p>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
