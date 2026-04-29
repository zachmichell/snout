// Admin-only tab for publishing and editing changelog entries scoped
// to the current org. The shape is deliberately spartan: title, body
// (markdown), severity, optional module filter, and a publish toggle.
//
// Drafts (published_at IS NULL) are listed separately at the bottom so
// admins can resume them without scrolling through the live feed.
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  useChangelogFeed,
  useChangelogDrafts,
  useUpsertChangelogEntry,
  useDeleteChangelogEntry,
  type ChangelogEntry,
  type ChangelogSeverity,
} from "@/hooks/useChangelog";
import { formatDateTime } from "@/lib/money";

const MODULES = ["daycare", "boarding", "grooming", "training", "retail"] as const;
type Module = (typeof MODULES)[number];

export default function ChangelogTab() {
  const [editing, setEditing] = useState<ChangelogEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: feed } = useChangelogFeed();
  const { data: drafts } = useChangelogDrafts();
  const upsert = useUpsertChangelogEntry();
  const remove = useDeleteChangelogEntry();

  // Both editor states (creating-new, editing-existing) drive the same
  // form; controlled separately to avoid stale draft contamination.
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<ChangelogSeverity>("update");
  const [modules, setModules] = useState<Module[]>([]);
  const [publishNow, setPublishNow] = useState(true);

  const beginEdit = (entry: ChangelogEntry | null) => {
    if (entry) {
      setEditing(entry);
      setCreating(false);
      setTitle(entry.title);
      setBody(entry.body_md);
      setSeverity(entry.severity);
      setModules((entry.affects_modules ?? []) as Module[]);
      setPublishNow(!!entry.published_at);
    } else {
      setCreating(true);
      setEditing(null);
      setTitle("");
      setBody("");
      setSeverity("update");
      setModules([]);
      setPublishNow(true);
    }
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const handleSave = async () => {
    if (title.trim().length < 3) {
      toast.error("Title is required");
      return;
    }
    if (body.trim().length < 5) {
      toast.error("Body is required");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: editing?.id,
        title: title.trim(),
        body_md: body,
        severity,
        affects_modules: modules.length > 0 ? modules : null,
        publish: publishNow,
      });
      toast.success(publishNow ? "Entry published" : "Saved as draft");
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save entry");
    }
  };

  const editorActive = creating || !!editing;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-foreground">Changelog</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Publish updates and announcements that everyone in your organization sees
            in the support widget. Drafts stay private until you publish.
          </p>
        </div>
        {!editorActive && (
          <Button onClick={() => beginEdit(null)} size="sm">
            <Plus className="h-4 w-4" /> New entry
          </Button>
        )}
      </div>

      {editorActive && (
        <div className="rounded-lg border border-border bg-surface p-5 shadow-card space-y-4">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Holiday booking blackout: December 20-26"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as ChangelogSeverity)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Affects modules (optional)</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {MODULES.map((m) => {
                  const active = modules.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setModules((prev) =>
                          prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
                        active
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-background text-text-secondary"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Body (markdown)</Label>
            <Textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="**What changed**: ..."
              className="mt-1 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Markdown supported: bold, italics, lists, links.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle pt-4">
            <div className="flex items-center gap-3">
              <Switch checked={publishNow} onCheckedChange={setPublishNow} id="publish" />
              <Label htmlFor="publish" className="text-sm">
                Publish now
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={close} disabled={upsert.isPending}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>
                {upsert.isPending ? "Saving..." : editing ? "Save changes" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Section title="Published" entries={feed ?? []} onEdit={beginEdit} onDelete={(id) => remove.mutate(id)} />

      {drafts && drafts.length > 0 && (
        <Section title="Drafts" entries={drafts} onEdit={beginEdit} onDelete={(id) => remove.mutate(id)} />
      )}
    </div>
  );
}

function Section({
  title,
  entries,
  onEdit,
  onDelete,
}: {
  title: string;
  entries: ChangelogEntry[];
  onEdit: (entry: ChangelogEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="label-eyebrow">{title}</h3>
        <p className="mt-2 text-sm text-text-secondary">Nothing yet.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="label-eyebrow">{title}</h3>
      <ul className="mt-2 divide-y divide-border-subtle rounded-lg border border-border bg-surface">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-secondary">
                  {entry.severity}
                </span>
                <h4 className="truncate font-medium text-foreground">{entry.title}</h4>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                {entry.published_at
                  ? `Published ${formatDateTime(entry.published_at)}`
                  : `Created ${formatDateTime(entry.created_at)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => onEdit(entry)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Anyone who has not yet read it will no longer see it. Soft delete;
                      can be restored from the database if needed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(entry.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
