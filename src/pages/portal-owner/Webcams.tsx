// Owner-facing webcam list. Shows cameras for the owner's organization,
// filtered to locations where their pets currently have an active
// reservation (status in confirmed, checked_in). The intent: when your
// dog is at daycare today, you can watch the yard. When your dog is
// home, you don't.
//
// If the owner has no live reservations we still show all-location
// cameras (location_id IS NULL) so they can browse during off-hours
// without confusion. The filter is "active reservation -> location-
// specific cameras at that location -> plus any all-location cameras".
import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useAuth } from "@/hooks/useAuth";
import WebcamPlayer from "@/components/portal/WebcamPlayer";

type Webcam = {
  id: string;
  name: string;
  description: string | null;
  source_kind: "hls" | "mp4" | "iframe";
  source_url: string;
  location_id: string | null;
  enabled: boolean;
};

export default function OwnerWebcams() {
  const { membership } = useAuth();
  const { data: owner } = useOwnerRecord();
  const orgId = membership?.organization_id;

  // Active reservations carry the location_id we use to scope the
  // cameras. We pull just enough to compute the active-locations set.
  const { data: activeLocationIds } = useQuery({
    queryKey: ["owner-active-reservation-locations", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("reservations")
        .select("location_id, status")
        .eq("primary_owner_id", owner!.id)
        .in("status", ["confirmed", "checked_in"])
        .is("deleted_at", null);
      return Array.from(new Set((data ?? []).map((r) => r.location_id).filter(Boolean) as string[]));
    },
  });

  const { data: webcams, isLoading } = useQuery({
    queryKey: ["owner-webcams", orgId, (activeLocationIds ?? []).join(",")],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webcams")
        .select("id, name, description, source_kind, source_url, location_id, enabled")
        .eq("organization_id", orgId!)
        .eq("enabled", true)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      // Filter client-side: keep cameras with no location set (apply to
      // all), or cameras whose location matches an active reservation.
      const active = new Set(activeLocationIds ?? []);
      return (data ?? []).filter(
        (w) => w.location_id === null || active.has(w.location_id),
      ) as Webcam[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
          Live cameras
        </h1>
        <p className="mt-1 text-muted-foreground">
          Tap any feed to watch full screen or pop it out. Cameras refresh
          continuously; if a stream takes a moment to load, that is normal.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading cameras...</p>
      )}

      {!isLoading && (webcams ?? []).length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <Camera className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          No live cameras available right now. They appear here when your pet has
          a confirmed visit and the facility has cameras configured.
        </div>
      )}

      {webcams && webcams.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {webcams.map((w) => (
            <article
              key={w.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <WebcamPlayer source={{ kind: w.source_kind, url: w.source_url, name: w.name }} />
              <div className="p-4">
                <h2 className="font-display text-lg font-semibold text-foreground">{w.name}</h2>
                {w.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{w.description}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
