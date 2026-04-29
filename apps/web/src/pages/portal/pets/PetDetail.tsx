import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Archive, FileText, Check } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import StatusBadge, { intakeTone, relationshipTone } from "@/components/portal/StatusBadge";
import PetOwnersSection from "@/components/portal/PetOwnersSection";
import VaccinationFormDialog from "./VaccinationFormDialog";
import MedicationsTab from "@/components/portal/pet-care/MedicationsTab";
import FeedingTab from "@/components/portal/pet-care/FeedingTab";
import TraitsTab from "@/components/portal/pet-care/TraitsTab";
import PetIncidentsSection from "@/components/portal/pet-care/PetIncidentsSection";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { supabase } from "@/integrations/supabase/client";
import { calcAge, formatDate, formatVaccineType, isExpired, isExpiringSoon, kgToLbs, speciesIcon } from "@/lib/format";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { logActivity } from "@/lib/activity";
import { useAuth } from "@/hooks/useAuth";

export default function PetDetail() {
  const { can } = usePermissions();
  const { membership } = useAuth();
  const canEdit = can("pets.edit");
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [vaxOpen, setVaxOpen] = useState(false);
  const [editVax, setEditVax] = useState<any | null>(null);
  const [deleteVaxId, setDeleteVaxId] = useState<string | null>(null);

  const { data: pet } = useQuery({
    queryKey: ["pet", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pets").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: owners } = useQuery({
    queryKey: ["pet-owners", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pet_owners")
        .select("id, relationship, owner:owners(id, first_name, last_name, email, phone, deleted_at)")
        .eq("pet_id", id!);
      if (error) throw error;
      return (data ?? []).filter((r: any) => r.owner && !r.owner.deleted_at);
    },
  });

  const { data: vaccinations } = useQuery({
    queryKey: ["pet-vax", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vaccinations")
        .select("*")
        .eq("pet_id", id!)
        .is("deleted_at", null)
        .order("administered_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const archive = async () => {
    const { error } = await supabase.from("pets").update({ deleted_at: new Date().toISOString() }).eq("id", id!);
    if (error) return toast.error(error.message);
    if (membership) {
      await logActivity({
        organization_id: membership.organization_id,
        action: "deleted",
        entity_type: "pet",
        entity_id: id!,
        metadata: { name: pet?.name },
      });
    }
    toast.success("Pet archived");
    navigate("/pets");
  };

  const unlinkOwner = async (linkId: string) => {
    const { error } = await supabase.from("pet_owners").delete().eq("id", linkId);
    if (error) return toast.error(error.message);
    toast.success("Owner unlinked");
    qc.invalidateQueries({ queryKey: ["pet-owners", id] });
    setUnlinkId(null);
  };

  const deleteVax = async (vid: string) => {
    const { error } = await supabase.from("vaccinations").delete().eq("id", vid);
    if (error) return toast.error(error.message);
    toast.success("Vaccination removed");
    qc.invalidateQueries({ queryKey: ["pet-vax", id] });
    setDeleteVaxId(null);
  };

  const openDoc = async (url: string) => {
    // url stored is the path within bucket
    const { data, error } = await supabase.storage.from("vaccination-docs").createSignedUrl(url, 60);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  if (!pet) {
    return (
      <PortalLayout>
        <div className="px-8 py-6 text-sm text-text-secondary">Loading…</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            {pet.photo_url ? (
              <img src={pet.photo_url} alt={pet.name} className="h-24 w-24 rounded-full object-cover border border-border" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-light text-3xl">
                {speciesIcon(pet.species)}
              </div>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-2xl text-foreground">{pet.name}</h1>
                <StatusBadge tone={intakeTone(pet.intake_status)}>{pet.intake_status.replace("_", " ")}</StatusBadge>
              </div>
              <div className="mt-1 text-sm text-text-secondary capitalize">
                {pet.species}
                {pet.breed && ` · ${pet.breed}`}
              </div>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate(`/pets/${id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setArchiveOpen(true)}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </div>
          )}
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="bg-transparent border-b border-border-subtle rounded-none h-auto p-0 w-full justify-start gap-6">
            {["profile", "owners", "vax", "meds", "feeding", "traits", "incidents"].map((v, i) => (
              <TabsTrigger
                key={v}
                value={v}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3"
              >
                {["Profile", "Owners", "Vaccinations", "Medications", "Feeding", "Traits", "Incidents"][i]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="profile" className="mt-6 space-y-4">
            <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <div className="font-display text-base mb-3">Information</div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Detail label="Species" value={pet.species} capitalize />
                <Detail label="Breed" value={pet.breed} />
                <Detail label="Sex" value={pet.sex === "M" ? "Male" : pet.sex === "F" ? "Female" : "Unknown"} />
                <Detail label="Spayed / Neutered" value={pet.spayed_neutered ? "Yes" : "No"} />
                <Detail
                  label="Birthdate"
                  value={pet.date_of_birth ? `${formatDate(pet.date_of_birth)} (${calcAge(pet.date_of_birth)})` : null}
                />
                <Detail
                  label="Weight"
                  value={pet.weight_kg ? `${pet.weight_kg} kg (${kgToLbs(pet.weight_kg)} lbs)` : null}
                />
                <Detail label="Color" value={pet.color} />
                <Detail label="Markings" value={(pet as any).markings} />
                <Detail label="Microchip" value={pet.microchip_id} />
              </dl>
            </div>

            {(pet as any).temperament_tags?.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="font-display text-base mb-3">Temperament</div>
                <div className="flex flex-wrap gap-1.5">
                  {(pet as any).temperament_tags.map((t: string) => (
                    <span key={t} className="rounded-pill border border-border bg-background px-2.5 py-1 text-xs">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {pet.behavioral_notes && (
              <NotesCard title="Behavior Notes" content={pet.behavioral_notes} />
            )}
            {pet.feeding_notes && <NotesCard title="Feeding Notes" content={pet.feeding_notes} />}
            {pet.medication_notes && <NotesCard title="Medication Notes" content={pet.medication_notes} />}
          </TabsContent>

          <TabsContent value="owners" className="mt-6">
            <PetOwnersSection petId={id!} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="vax" className="mt-6">
            <div className="rounded-lg border border-border bg-surface shadow-card">
              <div className="flex items-center justify-between border-b border-border-subtle p-4">
                <div className="font-display text-base">Vaccinations</div>
                <Button size="sm" onClick={() => { setEditVax(null); setVaxOpen(true); }}>
                  <Plus className="h-4 w-4" /> Add Vaccination
                </Button>
              </div>
              {!vaccinations || vaccinations.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-secondary">No vaccination records yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background text-left">
                      <th className="px-[18px] py-[14px] label-eyebrow">Vaccine</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Administered</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Expires</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Vet / Clinic</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Verified</th>
                      <th className="px-[18px] py-[14px] label-eyebrow">Doc</th>
                      <th className="px-[18px] py-[14px] label-eyebrow text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaccinations.map((v) => {
                      const expired = isExpired(v.expires_on);
                      const expiringSoon = isExpiringSoon(v.expires_on);
                      return (
                        <tr key={v.id} className="border-t border-border-subtle hover:bg-background">
                          <td className="px-[18px] py-[14px] font-medium text-foreground">
                            {formatVaccineType(v.vaccine_type)}
                          </td>
                          <td className="px-[18px] py-[14px] text-text-secondary">{formatDate(v.administered_on)}</td>
                          <td className="px-[18px] py-[14px]">
                            <span className={expired ? "text-destructive font-medium" : expiringSoon ? "text-warning font-medium" : "text-text-secondary"}>
                              {formatDate(v.expires_on)}
                            </span>
                          </td>
                          <td className="px-[18px] py-[14px] text-text-secondary">
                            {[(v as any).vet_name, (v as any).vet_clinic].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className="px-[18px] py-[14px]">
                            {v.verified ? <Check className="h-4 w-4 text-success" /> : <span className="text-text-tertiary">—</span>}
                          </td>
                          <td className="px-[18px] py-[14px]">
                            {v.document_url ? (
                              <button onClick={() => openDoc(v.document_url!)} className="text-primary hover:underline">
                                <FileText className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-text-tertiary">—</span>
                            )}
                          </td>
                          <td className="px-[18px] py-[14px] text-right text-xs font-semibold">
                            <button onClick={() => { setEditVax(v); setVaxOpen(true); }} className="mr-3 text-primary hover:underline">
                              Edit
                            </button>
                            <button onClick={() => setDeleteVaxId(v.id)} className="text-destructive hover:underline">
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="meds" className="mt-6">
            <MedicationsTab petId={id!} />
          </TabsContent>

          <TabsContent value="feeding" className="mt-6">
            <FeedingTab petId={id!} />
          </TabsContent>

          <TabsContent value="traits" className="mt-6">
            <TraitsTab petId={id!} />
          </TabsContent>

          <TabsContent value="incidents" className="mt-6">
            <PetIncidentsSection petId={id!} />
          </TabsContent>
        </Tabs>
      </div>

      <VaccinationFormDialog
        open={vaxOpen}
        onOpenChange={setVaxOpen}
        petId={id!}
        existing={editVax}
        onSaved={() => qc.invalidateQueries({ queryKey: ["pet-vax", id] })}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive pet?</AlertDialogTitle>
            <AlertDialogDescription>This pet will be hidden from lists.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteVaxId} onOpenChange={(o) => !o && setDeleteVaxId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vaccination?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteVaxId && deleteVax(deleteVaxId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  );
}

function Detail({ label, value, capitalize }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">{label}</dt>
      <dd className={`mt-0.5 text-sm text-foreground ${capitalize ? "capitalize" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

function NotesCard({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="font-display text-base mb-2">{title}</div>
      <p className="whitespace-pre-wrap text-sm text-text-secondary">{content}</p>
    </div>
  );
}
