import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Species = Database["public"]["Enums"]["species_enum"];
type Sex = Database["public"]["Enums"]["sex_enum"];
type IntakeStatus = Database["public"]["Enums"]["intake_status_enum"];
type Relationship = Database["public"]["Enums"]["pet_owner_relationship"];

const TAG_SUGGESTIONS = [
  "Good with other dogs",
  "Reactive on leash",
  "Shy with strangers",
  "High energy",
  "Resource guarder",
  "Separation anxiety",
];

type FormState = {
  name: string;
  species: Species;
  breed: string;
  sex: Sex;
  spayed_neutered: boolean;
  date_of_birth: string;
  weight_kg: string;
  color: string;
  markings: string;
  microchip_id: string;
  feeding_notes: string;
  medication_notes: string;
  behavioral_notes: string;
  temperament_tags: string[];
  intake_status: IntakeStatus;
};

const empty: FormState = {
  name: "",
  species: "dog",
  breed: "",
  sex: "U",
  spayed_neutered: false,
  date_of_birth: "",
  weight_kg: "",
  color: "",
  markings: "",
  microchip_id: "",
  feeding_notes: "",
  medication_notes: "",
  behavioral_notes: "",
  temperament_tags: [],
  intake_status: "pending_review",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="label-eyebrow mb-3">{title}</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
  span = 1,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? "md:col-span-2" : ""}>
      <label className="mb-1.5 block text-xs font-semibold text-text-secondary">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function PetForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { membership } = useAuth();
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [linkOwnerId, setLinkOwnerId] = useState<string>("");
  const [linkRelationship, setLinkRelationship] = useState<Relationship>("primary");
  const [ownerSearch, setOwnerSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: existing } = useQuery({
    queryKey: ["pet", id],
    enabled: isEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from("pets").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: ownerOptions } = useQuery({
    queryKey: ["owner-search", ownerSearch],
    enabled: !isEdit,
    queryFn: async () => {
      let q = supabase.from("owners").select("id, first_name, last_name, email").is("deleted_at", null).limit(15);
      const t = ownerSearch.trim();
      if (t) q = q.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,email.ilike.%${t}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        species: existing.species,
        breed: existing.breed ?? "",
        sex: existing.sex,
        spayed_neutered: existing.spayed_neutered ?? false,
        date_of_birth: existing.date_of_birth ?? "",
        weight_kg: existing.weight_kg != null ? String(existing.weight_kg) : "",
        color: existing.color ?? "",
        markings: (existing as any).markings ?? "",
        microchip_id: existing.microchip_id ?? "",
        feeding_notes: existing.feeding_notes ?? "",
        medication_notes: existing.medication_notes ?? "",
        behavioral_notes: existing.behavioral_notes ?? "",
        temperament_tags: (existing as any).temperament_tags ?? [],
        intake_status: existing.intake_status,
      });
      if (existing.photo_url) setPhotoPreview(existing.photo_url);
    }
  }, [existing]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handlePhoto = (file: File | null) => {
    setPhotoFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setPhotoPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const addTag = (t: string) => {
    const tag = t.trim();
    if (!tag || form.temperament_tags.includes(tag)) return;
    update("temperament_tags", [...form.temperament_tags, tag]);
    setTagInput("");
  };
  const removeTag = (t: string) =>
    update("temperament_tags", form.temperament_tags.filter((x) => x !== t));

  const validate = () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.species) e.species = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate() || !membership) return;
    setSaving(true);

    const payload: any = {
      name: form.name.trim(),
      species: form.species,
      breed: form.breed || null,
      sex: form.sex,
      spayed_neutered: form.spayed_neutered,
      date_of_birth: form.date_of_birth || null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      color: form.color || null,
      markings: form.markings || null,
      microchip_id: form.microchip_id || null,
      feeding_notes: form.feeding_notes || null,
      medication_notes: form.medication_notes || null,
      behavioral_notes: form.behavioral_notes || null,
      temperament_tags: form.temperament_tags,
      intake_status: form.intake_status,
      organization_id: membership.organization_id,
    };

    let petId = id;
    if (isEdit) {
      const { error } = await supabase.from("pets").update(payload).eq("id", id!);
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
      await logActivity({
        organization_id: membership.organization_id,
        action: "updated",
        entity_type: "pet",
        entity_id: id!,
        metadata: { name: form.name },
      });
    } else {
      const { data, error } = await supabase.from("pets").insert(payload).select("id").single();
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
      petId = data.id;
      await logActivity({
        organization_id: membership.organization_id,
        action: "created",
        entity_type: "pet",
        entity_id: data.id,
        metadata: { name: form.name },
      });
    }

    // Photo upload
    if (photoFile && petId) {
      const ext = photoFile.name.split(".").pop();
      const path = `${membership.organization_id}/${petId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("pet-photos").upload(path, photoFile, { upsert: true });
      if (upErr) {
        toast.error(`Photo upload failed: ${upErr.message}`);
      } else {
        const { data: pub } = supabase.storage.from("pet-photos").getPublicUrl(path);
        await supabase.from("pets").update({ photo_url: pub.publicUrl }).eq("id", petId);
      }
    }

    // Link owner on create
    if (!isEdit && linkOwnerId && petId) {
      const { error: linkErr } = await supabase.from("pet_owners").insert({
        organization_id: membership.organization_id,
        pet_id: petId,
        owner_id: linkOwnerId,
        relationship: linkRelationship,
      });
      if (linkErr) toast.error(`Owner link failed: ${linkErr.message}`);
    }

    setSaving(false);
    toast.success(isEdit ? "Pet updated" : "Pet created");
    navigate(`/pets/${petId}`);
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader title={isEdit ? "Edit Pet" : "New Pet"} />

        <form onSubmit={handleSubmit} className="mx-auto max-w-[720px]">
          <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
            <Section title="Basic Information">
              <Field label="Name" required error={errors.name}>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
              </Field>
              <Field label="Species" required>
                <Select value={form.species} onValueChange={(v) => update("species", v as Species)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dog">Dog</SelectItem>
                    <SelectItem value="cat">Cat</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Breed">
                <Input value={form.breed} onChange={(e) => update("breed", e.target.value)} />
              </Field>
              <Field label="Sex">
                <Select value={form.sex} onValueChange={(v) => update("sex", v as Sex)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="F">Female</SelectItem>
                    <SelectItem value="U">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Birthdate">
                <Input type="date" value={form.date_of_birth} onChange={(e) => update("date_of_birth", e.target.value)} />
              </Field>
              <Field label="Weight (kg)">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.weight_kg}
                  onChange={(e) => update("weight_kg", e.target.value)}
                />
              </Field>
              <Field label="Color">
                <Input value={form.color} onChange={(e) => update("color", e.target.value)} />
              </Field>
              <Field label="Markings">
                <Input value={form.markings} onChange={(e) => update("markings", e.target.value)} />
              </Field>
              <Field label="Microchip Number" span={2}>
                <Input value={form.microchip_id} onChange={(e) => update("microchip_id", e.target.value)} />
              </Field>
              <div className="md:col-span-2 flex items-center gap-2">
                <Checkbox
                  id="sn"
                  checked={form.spayed_neutered}
                  onCheckedChange={(v) => update("spayed_neutered", v === true)}
                />
                <label htmlFor="sn" className="text-sm text-foreground">Spayed / Neutered</label>
              </div>
            </Section>

            <Section title="Photo">
              <div className="md:col-span-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
                />
                {photoPreview ? (
                  <div className="flex items-center gap-4">
                    <img src={photoPreview} alt="Pet" className="h-24 w-24 rounded-lg object-cover border border-border" />
                    <div className="flex flex-col gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                        Replace
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setPhotoFile(null);
                          setPhotoPreview(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-background py-8 text-center text-sm text-text-secondary hover:border-primary hover:text-primary"
                  >
                    <Upload className="mb-2 h-5 w-5" />
                    Click to upload a photo
                  </button>
                )}
              </div>
            </Section>

            <Section title="Health & Behavior">
              <Field label="Behavior Notes" span={2}>
                <Textarea rows={3} value={form.behavioral_notes} onChange={(e) => update("behavioral_notes", e.target.value)} />
              </Field>
              <Field label="Feeding Notes" span={2}>
                <Textarea rows={3} value={form.feeding_notes} onChange={(e) => update("feeding_notes", e.target.value)} />
              </Field>
              <Field label="Medication Notes" span={2}>
                <Textarea rows={3} value={form.medication_notes} onChange={(e) => update("medication_notes", e.target.value)} />
              </Field>
            </Section>

            <Section title="Temperament Tags">
              <div className="md:col-span-2 space-y-3">
                <Input
                  placeholder="Type a tag and press Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                />
                {form.temperament_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.temperament_tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-pill border border-border bg-background px-2.5 py-1 text-xs">
                        {t}
                        <button type="button" onClick={() => removeTag(t)} className="text-text-tertiary hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="label-eyebrow mb-1.5">Suggestions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_SUGGESTIONS.filter((s) => !form.temperament_tags.includes(s)).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => addTag(s)}
                        className="rounded-pill border border-border-subtle bg-background px-2.5 py-1 text-xs text-text-secondary hover:border-primary hover:text-primary"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Intake Status">
              <Field label="Status">
                <Select value={form.intake_status} onValueChange={(v) => update("intake_status", v as IntakeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending_review">Pending Review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="restricted">Restricted</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Section>

            {!isEdit && (
              <Section title="Owner Assignment (optional)">
                <Field label="Search Owner" span={2}>
                  <Input
                    placeholder="Type owner name or email…"
                    value={ownerSearch}
                    onChange={(e) => setOwnerSearch(e.target.value)}
                  />
                  {ownerOptions && ownerOptions.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border">
                      {ownerOptions.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setLinkOwnerId(o.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background ${linkOwnerId === o.id ? "bg-primary-light" : ""}`}
                        >
                          <span>{o.first_name} {o.last_name}</span>
                          <span className="text-xs text-text-secondary">{o.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
                {linkOwnerId && (
                  <Field label="Relationship">
                    <Select value={linkRelationship} onValueChange={(v) => setLinkRelationship(v as Relationship)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="primary">Primary</SelectItem>
                        <SelectItem value="secondary">Secondary</SelectItem>
                        <SelectItem value="emergency_only">Emergency Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </Section>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Pet"}</Button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
