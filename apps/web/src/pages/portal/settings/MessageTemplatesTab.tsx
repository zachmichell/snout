import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renderTemplate } from "@/lib/message-templates";

// The four lifecycle events the resolver can fire on. Keep aligned with
// MessageEventType in src/lib/message-templates.ts.
const EVENTS: { value: string; label: string }[] = [
  { value: "reservation_confirmation", label: "Reservation confirmation" },
  { value: "invoice_created", label: "Invoice created" },
  { value: "report_card_published", label: "Report card published" },
  { value: "waiver_reminder", label: "Waiver reminder" },
  { value: "reservation_reminder", label: "Reservation reminder" },
  { value: "birthday", label: "Birthday" },
];

const MODULES: { value: string; label: string }[] = [
  { value: "__default__", label: "Default for any module" },
  { value: "daycare", label: "Daycare only" },
  { value: "boarding", label: "Boarding only" },
  { value: "grooming", label: "Grooming only" },
  { value: "training", label: "Training only" },
  { value: "retail", label: "Retail only" },
];

// Tokens available per event type. Sample values are used for the live
// preview pane so staff can see what the rendered email will look like
// against representative data.
const TOKENS_BY_EVENT: Record<string, Array<{ name: string; sample: string }>> = {
  reservation_confirmation: [
    { name: "owner_first_name", sample: "Sarah" },
    { name: "pet_names", sample: "Biscuit" },
    { name: "service_name", sample: "Boarding, Overnight" },
    { name: "start_at", sample: "Apr 28, 2026 at 2:00 PM" },
    { name: "location_name", sample: "Smoke Test 2 Kennels" },
    { name: "reservation_id", sample: "44444444-..." },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
  invoice_created: [
    { name: "invoice_number", sample: "1024" },
    { name: "amount_display", sample: "$135.00" },
    { name: "due_date", sample: "May 5, 2026" },
    { name: "invoice_id", sample: "abcd-..." },
    { name: "pay_now_url", sample: "https://example.com/pay" },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
  report_card_published: [
    { name: "pet_name", sample: "Biscuit" },
    { name: "rating", sample: "great" },
    { name: "rating_emoji", sample: "🐾" },
    { name: "mood_summary", sample: "Happy and social" },
    { name: "visit_notes", sample: "Played fetch all afternoon." },
    { name: "photo_url", sample: "https://..." },
    { name: "reservation_id", sample: "abc-..." },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
  waiver_reminder: [
    { name: "waiver_titles", sample: "Liability Waiver" },
    { name: "owner_first_name", sample: "Sarah" },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
  reservation_reminder: [
    { name: "owner_first_name", sample: "Sarah" },
    { name: "pet_names", sample: "Biscuit" },
    { name: "service_name", sample: "Daycare" },
    { name: "start_at", sample: "tomorrow at 8:00 AM" },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
  birthday: [
    { name: "pet_name", sample: "Biscuit" },
    { name: "owner_first_name", sample: "Sarah" },
    { name: "org_name", sample: "Smoke Test 2 Kennels" },
  ],
};

type Template = {
  id: string;
  name: string;
  channel: "email" | "sms";
  event_type: string | null;
  service_module: string | null;
  location_id: string | null;
  subject: string | null;
  body: string;
  active: boolean;
  category: string;
  updated_at: string;
};

type LocationOption = { id: string; name: string };
const ANY_LOCATION = "__default__";

export default function MessageTemplatesTab() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["message-templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select(
          "id, name, channel, event_type, service_module, location_id, subject, body, active, category, updated_at",
        )
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("event_type", { ascending: true, nullsFirst: false })
        .order("service_module", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });

  // Locations for the editor's per-location scope picker. Multi-location
  // orgs typically want at least the welcome / confirmation emails per
  // location; single-location orgs get a no-op picker.
  const { data: locations = [] } = useQuery({
    queryKey: ["templates-locations", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<LocationOption[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as LocationOption[];
    },
  });
  const locationName = (id: string | null) =>
    id ? locations.find((l) => l.id === id)?.name ?? "Unknown location" : null;

  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      const key = t.event_type ?? "__legacy__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [templates]);

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("message_templates")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template deleted");
      qc.invalidateQueries({ queryKey: ["message-templates", orgId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete template"),
  });

  if (!orgId) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-foreground">Message templates</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Customize the subject and body that customers receive for each lifecycle event.
            Per-module templates beat the org default. The system fallback is used when no
            template applies.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-1">
          <Plus className="h-4 w-4" /> New template
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-text-secondary">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-secondary">
          No templates yet. The system uses Snout's built-in defaults until you create one.
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([eventKey, rows]) => {
            const event = EVENTS.find((e) => e.value === eventKey);
            const heading = event?.label ?? "Legacy templates (no event type)";
            return (
              <div key={eventKey} className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border-subtle px-5 py-3">
                  <div className="font-display text-base text-foreground">{heading}</div>
                </div>
                <ul className="divide-y divide-border-subtle">
                  {rows.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {t.name}
                          {t.service_module && (
                            <span className="ml-2 inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                              {t.service_module}
                            </span>
                          )}
                          {locationName(t.location_id) && (
                            <span className="ml-2 inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                              {locationName(t.location_id)}
                            </span>
                          )}
                          {!t.active && (
                            <span className="ml-2 inline-flex items-center rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-text-tertiary">
                              inactive
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-text-tertiary">
                          {t.channel} · {t.subject ?? "no subject"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t)} className="gap-1">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Delete "${t.name}"?`)) softDelete.mutate(t.id);
                          }}
                          className="gap-1 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {(editing || creating) && (
        <TemplateEditor
          orgId={orgId}
          existing={editing}
          locations={locations}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["message-templates", orgId] });
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  orgId,
  existing,
  locations,
  onClose,
  onSaved,
}: {
  orgId: string;
  existing: Template | null;
  locations: LocationOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [channel, setChannel] = useState<"email" | "sms">(existing?.channel ?? "email");
  const [eventType, setEventType] = useState<string>(existing?.event_type ?? EVENTS[0].value);
  const [serviceModule, setServiceModule] = useState<string>(existing?.service_module ?? "__default__");
  const [locationId, setLocationId] = useState<string>(existing?.location_id ?? ANY_LOCATION);
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [active, setActive] = useState(existing?.active ?? true);

  const tokens = TOKENS_BY_EVENT[eventType] ?? [];
  const sampleVars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of tokens) out[t.name] = t.sample;
    return out;
  }, [tokens]);
  const previewSubject = renderTemplate(subject, sampleVars);
  const previewBody = renderTemplate(body, sampleVars);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");
      if (!body.trim()) throw new Error("Body is required");
      const payload = {
        organization_id: orgId,
        name: name.trim(),
        channel,
        event_type: eventType,
        service_module: serviceModule === "__default__" ? null : (serviceModule as any),
        location_id: locationId === ANY_LOCATION ? null : locationId,
        subject: subject.trim() || null,
        body,
        active,
        category: existing?.category ?? "general",
      };
      if (existing) {
        const { error } = await supabase.from("message_templates").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("message_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(existing ? "Template updated" : "Template created");
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save template"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Boarding confirmation"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as "email" | "sms")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS (not yet wired)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Event</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENTS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Applies to</Label>
              <Select value={serviceModule} onValueChange={setServiceModule}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODULES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {locations.length > 0 && (
              <div>
                <Label className="text-xs">Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_LOCATION}>All locations</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  Pick a single location to override the default for that
                  facility, or leave on "All locations" for org-wide use.
                </p>
              </div>
            )}
            {channel === "email" && (
              <div>
                <Label className="text-xs">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Booking confirmed for {{pet_names}}"
                />
              </div>
            )}
            <div>
              <Label className="text-xs">Body</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder={
                  channel === "email"
                    ? "HTML or plain text. Use {{token}} placeholders."
                    : "Plain text. Use {{token}} placeholders."
                }
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} id="active" />
              <Label htmlFor="active" className="text-sm">
                Active
              </Label>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Available tokens</Label>
              <div className="rounded-md border border-border bg-background p-3">
                {tokens.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No tokens defined for this event.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {tokens.map((t) => (
                      <li key={t.name} className="flex items-baseline justify-between gap-3">
                        <code className="font-mono text-foreground">{`{{${t.name}}}`}</code>
                        <span className="truncate text-text-tertiary">{t.sample}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs">Preview (sample data)</Label>
              <div className="rounded-md border border-border bg-background">
                {channel === "email" && (
                  <div className="border-b border-border-subtle px-3 py-2 text-xs">
                    <span className="font-semibold text-text-secondary">Subject: </span>
                    <span className="text-foreground">{previewSubject || "(empty)"}</span>
                  </div>
                )}
                <div
                  className="max-h-64 overflow-auto px-3 py-2 text-sm"
                  // The preview body might contain HTML for email templates;
                  // render verbatim for SMS, and as-rich for email so staff
                  // see what the customer would actually see.
                  dangerouslySetInnerHTML={
                    channel === "email" ? { __html: previewBody || "(empty)" } : undefined
                  }
                >
                  {channel === "sms" ? previewBody || "(empty)" : null}
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {existing ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
