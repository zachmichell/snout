import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Upload, X, Send, Save, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useReservationCareLogs } from "@/hooks/useCareLogs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APPETITE_OPTIONS, ENERGY_OPTIONS, MOOD_OPTIONS, RATING_OPTIONS,
  SOCIABILITY_OPTIONS, buildSummary, inferAppetite,
} from "@/lib/care";
import { sendReportCardPublished } from "@/lib/email";
import { usePermissions } from "@/hooks/usePermissions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reservationId: string;
  petId: string;
  petName: string;
};

const MAX_PHOTOS = 5;

export default function ReportCardEditor({ open, onOpenChange, reservationId, petId, petName }: Props) {
  const { user, membership } = useAuth();
  const { can } = usePermissions();
  const canPublish = can("reportcards.publish");
  const qc = useQueryClient();

  const { data: card } = useQuery({
    queryKey: ["report-card", reservationId, petId, open],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_cards")
        .select("*")
        .eq("reservation_id", reservationId)
        .eq("pet_id", petId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: logs } = useReservationCareLogs(open ? reservationId : undefined);

  const [rating, setRating] = useState<string>("");
  const [mood, setMood] = useState<string>("");
  const [energy, setEnergy] = useState<string>("");
  const [appetite, setAppetite] = useState<string>("");
  const [sociability, setSociability] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoSignedUrls, setPhotoSignedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resolve signed display URLs whenever the path list changes.
  useEffect(() => {
    let cancelled = false;
    if (photos.length === 0) {
      setPhotoSignedUrls({});
      return;
    }
    (async () => {
      const { data, error } = await supabase.storage
        .from("report-card-photos")
        .createSignedUrls(photos, 3600);
      if (cancelled || error || !data) return;
      const map: Record<string, string> = {};
      data.forEach((d, i) => {
        if (d.signedUrl) map[photos[i]] = d.signedUrl;
      });
      setPhotoSignedUrls(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  // Hydrate when dialog opens
  useEffect(() => {
    if (!open) return;
    const petLogs = (logs ?? []).filter((l: any) => l.pet_id === petId);
    if (card) {
      setRating(card.overall_rating ?? "");
      setMood(card.mood ?? "");
      setEnergy(card.energy_level ?? "");
      setAppetite(card.appetite ?? "");
      setSociability(card.sociability ?? "");
      setSummary(card.summary ?? "");
      setPhotos(card.photo_urls ?? []);
    } else {
      // Auto-populate from logs
      setRating("");
      setMood("");
      setEnergy("");
      setSociability("");
      const feedingLogs = petLogs.filter((l: any) => l.log_type === "feeding");
      setAppetite(inferAppetite(feedingLogs) ?? "");
      setSummary(buildSummary(petName, petLogs as any));
      setPhotos([]);
    }
  }, [open, card, logs, petId, petName]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    if (!membership?.organization_id) return toast.error("Missing organization");
    if (photos.length + files.length > MAX_PHOTOS) return toast.error(`Max ${MAX_PHOTOS} photos`);
    setUploading(true);
    const newPaths: string[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${membership.organization_id}/${petId}/${reservationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("report-card-photos").upload(path, file);
      if (error) {
        toast.error(error.message);
        continue;
      }
      newPaths.push(path);
    }
    setPhotos((p) => [...p, ...newPaths]);
    setUploading(false);
  };

  const removePhoto = (path: string) => setPhotos((p) => p.filter((u) => u !== path));

  const save = async (publish: boolean) => {
    if (!membership?.organization_id) return toast.error("Missing organization");
    setBusy(true);
    const payload: any = {
      organization_id: membership.organization_id,
      pet_id: petId,
      reservation_id: reservationId,
      overall_rating: rating || null,
      mood: mood || null,
      energy_level: energy || null,
      appetite: appetite || null,
      sociability: sociability || null,
      summary: summary || null,
      photo_urls: photos,
      created_by: user?.id ?? null,
    };
    if (publish) {
      payload.published = true;
      payload.published_at = new Date().toISOString();
    } else if (!card) {
      payload.published = false;
    }
    const { error } = card
      ? await supabase.from("report_cards").update(payload).eq("id", card.id)
      : await supabase.from("report_cards").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(publish ? "Report card published" : "Report card saved");
    qc.invalidateQueries({ queryKey: ["report-card", reservationId, petId] });
    qc.invalidateQueries({ queryKey: ["reservation-report-cards", reservationId] });

    // Send report card email on publish (respects email_settings)
    if (publish && membership?.organization_id) {
      try {
        // Find primary owner email via reservation → primary_owner → owners
        const { data: resv } = await supabase
          .from("reservations")
          .select("primary_owner_id")
          .eq("id", reservationId)
          .maybeSingle();
        if (resv?.primary_owner_id) {
          const { data: owner } = await supabase
            .from("owners")
            .select("id, email")
            .eq("id", resv.primary_owner_id)
            .maybeSingle();
          if (owner?.email) {
            const ratingOpt = RATING_OPTIONS.find((o) => o.value === rating);
            // Sign the first photo for a 7-day window so the inbox <img> renders.
            let emailPhotoUrl: string | null = null;
            if (photos[0]) {
              const { data: signed } = await supabase.storage
                .from("report-card-photos")
                .createSignedUrl(photos[0], 60 * 60 * 24 * 7);
              emailPhotoUrl = signed?.signedUrl ?? null;
            }
            sendReportCardPublished({
              organization_id: membership.organization_id,
              to: owner.email,
              pet_name: petName,
              rating: ratingOpt?.label ?? rating ?? null,
              rating_emoji: ratingOpt?.emoji ?? null,
              mood_summary: summary || null,
              photo_url: emailPhotoUrl,
              reservation_id: reservationId,
              owner_id: owner.id,
            }).catch((e) => console.warn("report card email failed:", e));
          }
        }
      } catch (e) {
        console.warn("report card email lookup failed:", e);
      }
    }

    onOpenChange(false);
  };

  const unpublish = async () => {
    if (!card) return;
    setBusy(true);
    const { error } = await supabase
      .from("report_cards")
      .update({ published: false, published_at: null })
      .eq("id", card.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Unpublished");
    qc.invalidateQueries({ queryKey: ["report-card", reservationId, petId] });
    qc.invalidateQueries({ queryKey: ["reservation-report-cards", reservationId] });
  };

  const isPublished = !!card?.published;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Report Card · <span className="font-display">{petName}</span>
            {isPublished && (
              <span className="ml-2 inline-flex items-center rounded-pill bg-success-light px-2 py-0.5 text-xs font-semibold text-success">
                Published
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <Section label="Overall rating">
            <div className="flex flex-wrap gap-2">
              {RATING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRating(opt.value)}
                  className={`rounded-md border px-3 py-2 text-sm transition ${
                    rating === opt.value ? `${opt.tone} border-transparent` : "border-border bg-background hover:bg-surface"
                  }`}
                >
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 sm:grid-cols-2">
            <PillGroup label="Mood" value={mood} onChange={setMood} options={MOOD_OPTIONS.map((m) => ({ value: m.value, label: `${m.emoji} ${m.label}` }))} />
            <PillGroup label="Energy" value={energy} onChange={setEnergy} options={ENERGY_OPTIONS} />
            <PillGroup label="Appetite" value={appetite} onChange={setAppetite} options={APPETITE_OPTIONS} />
            <PillGroup label="Sociability" value={sociability} onChange={setSociability} options={SOCIABILITY_OPTIONS} />
          </div>

          <Section label="Summary">
            <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={`How was ${petName}'s day?`} />
            <p className="mt-1 text-xs text-text-tertiary">Auto-drafted from today's care logs. Edit as needed.</p>
          </Section>

          <Section label={`Photos (${photos.length}/${MAX_PHOTOS})`}>
            <div className="flex flex-wrap gap-2">
              {photos.map((path) => (
                <div key={path} className="relative h-20 w-20">
                  <img src={photoSignedUrls[path] ?? ""} alt="" className="h-full w-full rounded-md object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(path)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-1 text-background hover:opacity-90"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-border text-text-tertiary hover:bg-background">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                </label>
              )}
            </div>
          </Section>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:gap-2">
          {isPublished && canPublish && (
            <Button variant="outline" onClick={unpublish} disabled={busy}>
              <EyeOff className="h-4 w-4" /> Unpublish
            </Button>
          )}
          <Button variant="outline" onClick={() => save(false)} disabled={busy}>
            <Save className="h-4 w-4" /> Save draft
          </Button>
          {canPublish && (
            <Button onClick={() => save(true)} disabled={busy}>
              <Send className="h-4 w-4" /> {isPublished ? "Re-publish" : "Publish & send"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function PillGroup({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(value === opt.value ? "" : opt.value)}
            className={`rounded-pill border px-2.5 py-1 text-xs transition ${
              value === opt.value
                ? "border-primary bg-primary-light text-primary-hover"
                : "border-border bg-background hover:bg-surface text-text-secondary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
