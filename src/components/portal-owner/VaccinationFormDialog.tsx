import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VACCINE_TYPES } from "@/lib/vaccines";
import { logActivity } from "@/lib/activity";

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const ACCEPTED_DOC = ["application/pdf", "image/jpeg", "image/png"];

type VaxRow = {
  id: string;
  vaccine_type: string;
  administered_on: string | null;
  expires_on: string | null;
  vet_name: string | null;
  vet_clinic: string | null;
  document_url: string | null;
};

function extractStoragePath(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/vaccination-docs\/(.+)$/);
  return m ? m[1].split("?")[0] : null;
}

async function fetchPetName(petId: string): Promise<string | null> {
  const { data } = await supabase.from("pets").select("name").eq("id", petId).maybeSingle();
  return data?.name ?? null;
}

export default function VaccinationFormDialog({
  open,
  onOpenChange,
  petId,
  organizationId,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  petId: string;
  organizationId: string;
  existing?: VaxRow | null;
}) {
  const qc = useQueryClient();
  const [vaccineType, setVaccineType] = useState<string>("rabies");
  const [administeredOn, setAdministeredOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [vetName, setVetName] = useState("");
  const [vetClinic, setVetClinic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVaccineType(existing?.vaccine_type ?? "rabies");
      setAdministeredOn(existing?.administered_on ?? "");
      setExpiresOn(existing?.expires_on ?? "");
      setVetName(existing?.vet_name ?? "");
      setVetClinic(existing?.vet_clinic ?? "");
      setFile(null);
    }
  }, [open, existing]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!administeredOn || !expiresOn) {
      toast.error("Administered and expiration dates are required.");
      return;
    }
    if (file) {
      if (!ACCEPTED_DOC.includes(file.type)) {
        toast.error("Document must be PDF, JPG, or PNG.");
        return;
      }
      if (file.size > MAX_DOC_BYTES) {
        toast.error("Document must be under 10MB.");
        return;
      }
    }
    setSaving(true);
    try {
      let documentUrl = existing?.document_url ?? null;

      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
        const path = `${organizationId}/${petId}/${Date.now()}-${vaccineType}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("vaccination-docs")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        // Replace old file when editing
        const oldPath = extractStoragePath(existing?.document_url ?? null);
        if (oldPath) {
          await supabase.storage.from("vaccination-docs").remove([oldPath]);
        }
        documentUrl = path; // store path; we'll sign on read
      }

      const payload = {
        vaccine_type: vaccineType as any,
        administered_on: administeredOn,
        expires_on: expiresOn,
        vet_name: vetName || null,
        vet_clinic: vetClinic || null,
        document_url: documentUrl,
        verified: false,
        verified_at: null,
        verified_by_user_id: null,
      };

      let vaccinationId: string | null = existing?.id ?? null;
      if (existing) {
        const { error } = await supabase
          .from("vaccinations")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Record updated, pending staff verification");
      } else {
        const { data, error } = await supabase
          .from("vaccinations")
          .insert({
            ...payload,
            pet_id: petId,
            organization_id: organizationId,
          })
          .select("id")
          .single();
        if (error) throw error;
        vaccinationId = data?.id ?? null;
        toast.success("Vaccination record added, pending staff verification");
      }

      // Customer-side upload audit trail. Operators read this in the Pack
      // View "Recent customer uploads" surface and the Audit Log so a silent
      // upload cannot fail to reach staff.
      try {
        const petName = await fetchPetName(petId);
        await logActivity({
          organization_id: organizationId,
          action: existing ? "updated" : "uploaded",
          entity_type: "vaccination",
          entity_id: vaccinationId,
          metadata: {
            pet_id: petId,
            pet_name: petName,
            vaccine_type: vaccineType,
            has_document: !!file,
            summary: `${petName ?? "Pet"}: ${vaccineType} vaccination ${existing ? "updated" : "uploaded"}`,
          },
          actor: { kind: "owner", label: "Owner" },
        });
      } catch (logErr) {
        // Logging must never block the upload itself.
        console.warn("activity_log write failed", logErr);
      }

      qc.invalidateQueries({ queryKey: ["pet-vaccinations", petId] });
      qc.invalidateQueries({ queryKey: ["owner-pets-full"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {existing ? "Edit vaccination record" : "Add vaccination record"}
          </DialogTitle>
          <DialogDescription>
            Records you submit are reviewed by staff before being marked verified.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vax-type">Vaccine type</Label>
            <Select value={vaccineType} onValueChange={setVaccineType}>
              <SelectTrigger id="vax-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VACCINE_TYPES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vax-admin">Administered *</Label>
              <Input
                id="vax-admin"
                type="date"
                value={administeredOn}
                onChange={(e) => setAdministeredOn(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vax-exp">Expires *</Label>
              <Input
                id="vax-exp"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vax-vet">Vet name</Label>
            <Input id="vax-vet" value={vetName} onChange={(e) => setVetName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vax-clinic">Clinic</Label>
            <Input id="vax-clinic" value={vetClinic} onChange={(e) => setVetClinic(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vax-doc">Document (PDF, JPG, PNG · max 10MB)</Label>
            <Input
              id="vax-doc"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {existing?.document_url && !file && (
              <p className="text-xs text-muted-foreground">
                Current document on file. Choose a new file to replace it.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? "Save changes" : "Add record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
