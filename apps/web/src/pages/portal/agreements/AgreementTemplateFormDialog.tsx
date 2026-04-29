import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { AGREEMENT_TYPES, MERGE_FIELDS, REQUIRED_FOR } from "@/lib/agreements";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type Template = {
  id: string;
  name: string;
  type: string;
  body: string;
  required_for: string;
  required_service_ids: string[];
  status: string;
  version: number;
};

export default function AgreementTemplateFormDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: Template | null;
}) {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [name, setName] = useState("");
  const [type, setType] = useState("waiver");
  const [body, setBody] = useState("");
  const [requiredFor, setRequiredFor] = useState("all");
  const [requiredServiceIds, setRequiredServiceIds] = useState<string[]>([]);
  const [status, setStatus] = useState("active");
  const bodyRef = (typeof window !== "undefined" ? { current: null as HTMLTextAreaElement | null } : null);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setType(template.type);
      setBody(template.body);
      setRequiredFor(template.required_for);
      setRequiredServiceIds(template.required_service_ids ?? []);
      setStatus(template.status);
    } else {
      setName("");
      setType("waiver");
      setBody("");
      setRequiredFor("all");
      setRequiredServiceIds([]);
      setStatus("active");
    }
  }, [template, open]);

  const { data: services = [] } = useQuery({
    queryKey: ["services-for-agreement", orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const insertToken = (token: string) => {
    setBody((b) => `${b}${b && !b.endsWith(" ") && !b.endsWith("\n") ? " " : ""}${token} `);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No organization");
      if (!name.trim()) throw new Error("Name is required");
      const payload = {
        organization_id: orgId,
        name: name.trim(),
        type,
        body,
        required_for: requiredFor,
        required_service_ids: requiredFor === "services" ? requiredServiceIds : [],
        status,
      };
      if (template) {
        const { error } = await supabase
          .from("agreement_templates")
          .update({ ...payload, version: (template.version ?? 1) + 1 })
          .eq("id", template.id);
        if (error) throw error;
        await logActivity({
          organization_id: orgId,
          action: "updated",
          entity_type: "agreement_template",
          entity_id: template.id,
          metadata: { name: payload.name },
        });
      } else {
        const { data, error } = await supabase
          .from("agreement_templates")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logActivity({
          organization_id: orgId,
          action: "created",
          entity_type: "agreement_template",
          entity_id: data.id,
          metadata: { name: payload.name },
        });
      }
    },
    onSuccess: () => {
      toast.success(template ? "Template updated" : "Template created");
      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{template ? "Edit Agreement Template" : "New Agreement Template"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Liability Waiver" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AGREEMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Required for</Label>
              <Select value={requiredFor} onValueChange={setRequiredFor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REQUIRED_FOR.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {requiredFor === "services" && (
              <div className="md:col-span-2">
                <Label>Pick services</Label>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
                  {services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No services available.</p>
                  ) : (
                    services.map((s: any) => {
                      const checked = requiredServiceIds.includes(s.id);
                      return (
                        <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setRequiredServiceIds((prev) =>
                                v ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                              );
                            }}
                          />
                          <span>{s.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <Label>Agreement Body</Label>
              <div className="flex flex-wrap gap-1">
                {MERGE_FIELDS.map((f) => (
                  <Button
                    key={f.token}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => insertToken(f.token)}
                  >
                    + {f.label}
                  </Button>
                ))}
              </div>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              placeholder="Write the full agreement text. Use merge fields like {{owner_name}} that will be filled in when signed."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Available merge fields: <code>{`{{owner_name}}`}</code>, <code>{`{{pet_name}}`}</code>, <code>{`{{date}}`}</code>, <code>{`{{business_name}}`}</code>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending ? "Saving…" : template ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
