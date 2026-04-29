import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type VaccineType = Database["public"]["Enums"]["vaccine_type_enum"];

const TYPES: { value: VaccineType; label: string }[] = [
  { value: "rabies", label: "Rabies" },
  { value: "dapp", label: "DAPP" },
  { value: "dhpp", label: "DHPP" },
  { value: "bordetella", label: "Bordetella" },
  { value: "lepto", label: "Lepto" },
  { value: "lyme", label: "Lyme" },
  { value: "influenza", label: "Influenza" },
  { value: "fvrcp", label: "FVRCP" },
  { value: "other", label: "Other" },
];

export default function VaccinationFormDialog({
  open,
  onOpenChange,
  petId,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  petId: string;
  existing?: any | null;
  onSaved: () => void;
}) {
  const { membership, user } = useAuth();
  const [vaccineType, setVaccineType] = useState<VaccineType>("rabies");
  const [otherName, setOtherName] = useState("");
  const [administered, setAdministered] = useState("");
  const [expires, setExpires] = useState("");
  const [vetName, setVetName] = useState("");
  const [vetClinic, setVetClinic] = useState("");
  const [verified, setVerified] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setVaccineType(existing.vaccine_type);
      setOtherName(existing.notes ?? "");
      setAdministered(existing.administered_on ?? "");
      setExpires(existing.expires_on ?? "");
      setVetName(existing.vet_name ?? "");
      setVetClinic(existing.vet_clinic ?? "");
      setVerified(existing.verified ?? false);
    } else {
      setVaccineType("rabies");
      setOtherName("");
      setAdministered("");
      setExpires("");
      setVetName("");
      setVetClinic("");
      setVerified(false);
    }
    setDocFile(null);
  }, [open, existing]);

  const save = async () => {
    if (!administered || !expires) return toast.error("Administered and expires dates are required");
    if (!membership) return;
    setSaving(true);

    let documentPath = existing?.document_url ?? null;
    if (docFile) {
      const ext = docFile.name.split(".").pop();
      const path = `${membership.organization_id}/${petId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("vaccination-docs").upload(path, docFile);
      if (upErr) {
        setSaving(false);
        return toast.error(`Upload failed: ${upErr.message}`);
      }
      documentPath = path;
    }

    const payload: any = {
      organization_id: membership.organization_id,
      pet_id: petId,
      vaccine_type: vaccineType,
      administered_on: administered,
      expires_on: expires,
      vet_name: vetName || null,
      vet_clinic: vetClinic || null,
      notes: vaccineType === "other" ? otherName || null : null,
      document_url: documentPath,
      verified,
      verified_by_user_id: verified ? user?.id ?? null : null,
      verified_at: verified ? new Date().toISOString() : null,
    };

    if (existing) {
      const { error } = await supabase.from("vaccinations").update(payload).eq("id", existing.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Vaccination updated");
    } else {
      const { error } = await supabase.from("vaccinations").insert(payload);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Vaccination added");
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display">{existing ? "Edit" : "Add"} Vaccination</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="label-eyebrow">Vaccine Type</label>
            <Select value={vaccineType} onValueChange={(v) => setVaccineType(v as VaccineType)}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {vaccineType === "other" && (
            <div>
              <label className="label-eyebrow">Custom Vaccine Name</label>
              <Input className="mt-1.5" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow">Administered *</label>
              <Input type="date" className="mt-1.5" value={administered} onChange={(e) => setAdministered(e.target.value)} />
            </div>
            <div>
              <label className="label-eyebrow">Expires *</label>
              <Input type="date" className="mt-1.5" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow">Vet Name</label>
              <Input className="mt-1.5" value={vetName} onChange={(e) => setVetName(e.target.value)} />
            </div>
            <div>
              <label className="label-eyebrow">Clinic</label>
              <Input className="mt-1.5" value={vetClinic} onChange={(e) => setVetClinic(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label-eyebrow">Document</label>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            <div className="mt-1.5 flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                Choose file
              </Button>
              <span className="text-xs text-text-secondary">
                {docFile ? docFile.name : existing?.document_url ? "Existing document attached" : "No file selected"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="verified" checked={verified} onCheckedChange={(v) => setVerified(v === true)} />
            <label htmlFor="verified" className="text-sm">Verified by staff</label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : existing ? "Update" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
