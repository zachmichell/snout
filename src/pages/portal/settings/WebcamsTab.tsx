// Admin tab for adding, editing, and disabling webcam feeds. The list
// is per-org and can be optionally scoped to a specific location so a
// multi-location operator can show pet parents only the cameras at the
// facility their pet is currently checked into.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import WebcamPlayer from "@/components/portal/WebcamPlayer";

type SourceKind = "hls" | "mp4" | "iframe";
type WebcamRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  name: string;
  provider: string | null;
  source_kind: SourceKind;
  source_url: string;
  description: string | null;
  enabled: boolean;
};

export default function WebcamsTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  const { data: locations } = useQuery({
    queryKey: ["org-locations", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      return data ?? [];
    },
  });

  const { data: webcams, isLoading } = useQuery({
    queryKey: ["webcams", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webcams")
        .select(
          "id, organization_id, location_id, name, provider, source_kind, source_url, description, enabled",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as WebcamRow[];
    },
  });

  const [editing, setEditing] = useState<WebcamRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("iframe");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState<string | "none">("none");
  const [enabled, setEnabled] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const upsert = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      const payload = {
        organization_id: orgId,
        location_id: locationId === "none" ? null : locationId,
        name: name.trim(),
        provider: provider.trim() || null,
        source_kind: sourceKind,
        source_url: sourceUrl.trim(),
        description: description.trim() || null,
        enabled,
      };
      if (editing) {
        const { error } = await supabase.from("webcams").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("webcams").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Webcam updated" : "Webcam added");
      qc.invalidateQueries({ queryKey: ["webcams", orgId] });
      close();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("webcams")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Webcam removed");
      qc.invalidateQueries({ queryKey: ["webcams", orgId] });
    },
  });

  const open = (row: WebcamRow | null) => {
    if (row) {
      setEditing(row);
      setCreating(false);
      setName(row.name);
      setProvider(row.provider ?? "");
      setSourceKind(row.source_kind);
      setSourceUrl(row.source_url);
      setDescription(row.description ?? "");
      setLocationId(row.location_id ?? "none");
      setEnabled(row.enabled);
    } else {
      setCreating(true);
      setEditing(null);
      setName("");
      setProvider("");
      setSourceKind("iframe");
      setSourceUrl("");
      setDescription("");
      setLocationId("none");
      setEnabled(true);
    }
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
    setPreviewUrl(null);
  };

  const editorActive = creating || !!editing;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-foreground">Webcams</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Connect customer-facing camera feeds. Pet parents see cameras for the
            facility their pet is currently visiting. Snout never proxies the stream;
            we just embed the URL you provide.
          </p>
        </div>
        {!editorActive && (
          <Button onClick={() => open(null)} size="sm">
            <Plus className="h-4 w-4" /> Add webcam
          </Button>
        )}
      </div>

      {editorActive && (
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Big yard camera"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Provider (optional)</Label>
              <Input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="UniFi Protect, Reolink, ..."
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Location (optional)</Label>
              <Select value={locationId} onValueChange={(v) => setLocationId(v as any)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All locations</SelectItem>
                  {(locations ?? []).map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Source kind</Label>
              <Select value={sourceKind} onValueChange={(v) => setSourceKind(v as SourceKind)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iframe">Iframe (embed URL)</SelectItem>
                  <SelectItem value="hls">HLS (.m3u8 stream)</SelectItem>
                  <SelectItem value="mp4">Direct video URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Source URL</Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Iframe: any URL the camera vendor exposes for viewing. HLS: a public or
              tokenized .m3u8. MP4: a stream or progressive file URL.
            </p>
          </div>

          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What pet parents will see in this view"
              className="mt-1"
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle pt-4">
            <div className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="enabled" />
              <Label htmlFor="enabled" className="text-sm">
                Enabled (visible to pet parents)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={!sourceUrl || sourceUrl.length < 8}
                onClick={() => setPreviewUrl(sourceUrl)}
              >
                Preview
              </Button>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => upsert.mutate()} disabled={upsert.isPending || !name.trim() || !sourceUrl.trim()}>
                {upsert.isPending ? "Saving..." : editing ? "Save changes" : "Add webcam"}
              </Button>
            </div>
          </div>

          {previewUrl && (
            <div className="border-t border-border-subtle pt-4">
              <p className="mb-2 text-xs text-text-tertiary">Preview</p>
              <WebcamPlayer source={{ kind: sourceKind, url: previewUrl, name: name || "Preview" }} />
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading...</p>
      ) : (webcams ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-text-secondary">
          <Camera className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
          No webcams yet. Add one to start showing live feeds to pet parents.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-surface">
          {(webcams ?? []).map((w) => {
            const location = (locations ?? []).find((l: any) => l.id === w.location_id);
            return (
              <li key={w.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate font-medium text-foreground">{w.name}</h4>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-secondary">
                      {w.source_kind}
                    </span>
                    {!w.enabled && (
                      <span className="rounded-full border border-warning/30 bg-warning-light px-2 py-0.5 text-[10px] uppercase tracking-wider text-warning">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {[w.provider, location?.name ?? "All locations"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => open(w)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this webcam?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Pet parents will no longer see it. Soft delete; can be restored
                          from the database.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove.mutate(w.id)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
