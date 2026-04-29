import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { speciesIcon } from "@/lib/format";
import { logActivity } from "@/lib/activity";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export default function PetPhotoUpload({
  petId,
  organizationId,
  species,
  photoUrl,
  onUploaded,
}: {
  petId: string;
  organizationId: string;
  species: string | null;
  photoUrl: string | null;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be under 5MB.");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${organizationId}/${petId}/photo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("pet-photos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("pet-photos").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: updErr } = await supabase
        .from("pets")
        .update({ photo_url: url })
        .eq("id", petId);
      if (updErr) throw updErr;

      try {
        const { data: pet } = await supabase
          .from("pets")
          .select("name")
          .eq("id", petId)
          .maybeSingle();
        await logActivity({
          organization_id: organizationId,
          action: "photo_uploaded",
          entity_type: "pet",
          entity_id: petId,
          metadata: {
            pet_id: petId,
            pet_name: pet?.name ?? null,
            summary: `${pet?.name ?? "Pet"}: photo uploaded`,
          },
          actor: { kind: "owner", label: "Owner" },
        });
      } catch (logErr) {
        console.warn("activity_log write failed", logErr);
      }

      onUploaded(url);
      toast.success("Photo updated");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative block h-[150px] w-[150px] overflow-hidden rounded-full border-2 border-border bg-muted"
        aria-label="Upload pet photo"
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-5xl">
            {speciesIcon(species)}
          </span>
        )}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-foreground/60 text-card opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <Camera className="h-6 w-6" />
              <span className="text-xs font-medium">Upload photo</span>
            </>
          )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
