import { useState } from "react";
import { Plus, Trash2, Pencil, GripVertical, FileText } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useReportCardTemplates, useUpsertReportCardTemplate, useDeleteReportCardTemplate,
  type ReportCardTemplate,
} from "@/hooks/useReportCardTemplates";
import {
  RC_FIELD_TYPES, newLocalId, type RCFieldType, type RCSection,
} from "@/lib/reportCardTemplates";

export default function ReportCardTemplates() {
  const { data: templates = [], isLoading } = useReportCardTemplates();
  const del = useDeleteReportCardTemplate();
  const [editing, setEditing] = useState<ReportCardTemplate | "new" | null>(null);

  return (
    <PortalLayout>
      <PageHeader
        title="Report Card Templates"
        description="Define reusable sections and fields staff can fill in when writing a report card."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-8 w-8 text-text-tertiary" />
            <div>
              <p className="font-medium text-foreground">No templates yet</p>
              <p className="text-sm text-text-secondary">
                Create a template to give report cards consistent, custom sections.
              </p>
            </div>
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => {
            const fieldCount = t.sections.reduce((n, s) => n + s.fields.length, 0);
            return (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base text-foreground">{t.name}</h3>
                      {t.is_default && <Badge className="bg-primary-light text-primary-hover">Default</Badge>}
                    </div>
                    {t.description && (
                      <p className="mt-0.5 truncate text-sm text-text-secondary">{t.description}</p>
                    )}
                    <p className="mt-1 text-xs text-text-tertiary">
                      {t.sections.length} section{t.sections.length === 1 ? "" : "s"} · {fieldCount} field
                      {fieldCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete template "${t.name}"? This won't affect already-published cards.`)) {
                          del.mutate(t.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <TemplateBuilderDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </PortalLayout>
  );
}

// MARK: - Builder dialog

function TemplateBuilderDialog({
  template,
  onClose,
}: {
  template: ReportCardTemplate | null;
  onClose: () => void;
}) {
  const upsert = useUpsertReportCardTemplate();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [isDefault, setIsDefault] = useState(template?.is_default ?? false);
  const [sections, setSections] = useState<RCSection[]>(
    template?.sections.length
      ? template.sections
      : [{ id: newLocalId("s"), title: "", fields: [{ id: newLocalId("f"), label: "", type: "text" }] }],
  );

  const addSection = () =>
    setSections((s) => [...s, { id: newLocalId("s"), title: "", fields: [] }]);
  const removeSection = (id: string) => setSections((s) => s.filter((x) => x.id !== id));
  const updateSection = (id: string, patch: Partial<RCSection>) =>
    setSections((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const addField = (sid: string) =>
    updateSectionFields(sid, (fields) => [...fields, { id: newLocalId("f"), label: "", type: "text" }]);
  const removeField = (sid: string, fid: string) =>
    updateSectionFields(sid, (fields) => fields.filter((f) => f.id !== fid));
  const updateSectionFields = (
    sid: string,
    fn: (fields: RCSection["fields"]) => RCSection["fields"],
  ) => setSections((s) => s.map((x) => (x.id === sid ? { ...x, fields: fn(x.fields) } : x)));

  const save = () => {
    // Drop empty sections/fields so the saved template is clean.
    const cleaned: RCSection[] = sections
      .map((s) => ({
        ...s,
        title: s.title.trim(),
        fields: s.fields
          .filter((f) => f.label.trim())
          .map((f) => ({
            ...f,
            label: f.label.trim(),
            options:
              f.type === "select"
                ? (f.options ?? []).map((o) => o.trim()).filter(Boolean)
                : undefined,
          })),
      }))
      .filter((s) => s.title || s.fields.length);

    upsert.mutate(
      { id: template?.id, name, description, sections: cleaned, is_default: isDefault },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New report card template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daycare Day" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Default template</p>
              <p className="text-xs text-text-tertiary">Pre-selected when staff open a new report card.</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          <div className="space-y-3">
            {sections.map((section, si) => (
              <div key={section.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-text-tertiary" />
                  <Input
                    value={section.title}
                    onChange={(e) => updateSection(section.id, { title: e.target.value })}
                    placeholder={`Section ${si + 1} title (e.g. Play & Activity)`}
                    className="font-medium"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeSection(section.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="mt-3 space-y-2 pl-6">
                  {section.fields.map((field) => (
                    <div key={field.id} className="space-y-2 rounded-md bg-muted/40 p-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={field.label}
                          onChange={(e) =>
                            updateSectionFields(section.id, (fs) =>
                              fs.map((f) => (f.id === field.id ? { ...f, label: e.target.value } : f)),
                            )
                          }
                          placeholder="Field label"
                        />
                        <Select
                          value={field.type}
                          onValueChange={(v) =>
                            updateSectionFields(section.id, (fs) =>
                              fs.map((f) => (f.id === field.id ? { ...f, type: v as RCFieldType } : f)),
                            )
                          }
                        >
                          <SelectTrigger className="w-36 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RC_FIELD_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="sm" onClick={() => removeField(section.id, field.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      {field.type === "select" && (
                        <Input
                          value={(field.options ?? []).join(", ")}
                          onChange={(e) =>
                            updateSectionFields(section.id, (fs) =>
                              fs.map((f) =>
                                f.id === field.id
                                  ? { ...f, options: e.target.value.split(",").map((o) => o.trim()) }
                                  : f,
                              ),
                            )
                          }
                          placeholder="Dropdown options, comma-separated"
                          className="text-sm"
                        />
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addField(section.id)}>
                    <Plus className="h-4 w-4" /> Add field
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={addSection}>
              <Plus className="h-4 w-4" /> Add section
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={upsert.isPending || !name.trim()}>
            {upsert.isPending ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
