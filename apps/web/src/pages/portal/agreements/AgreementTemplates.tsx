import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Printer } from "lucide-react";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logActivity } from "@/lib/activity";
import { agreementTypeLabel, requiredForLabel } from "@/lib/agreements";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AgreementTemplateFormDialog from "./AgreementTemplateFormDialog";

export default function AgreementTemplates() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["agreement-templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreement_templates")
        .select("*")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Render the template to a printable PDF and stream the download.
  // Uses functions.invoke so the user's JWT auths the request — RLS
  // on agreement_templates does the per-org gating server-side. The
  // PDF arrives as bytes; we wrap in a Blob and click a synthetic
  // <a download> for the filename hint.
  const printBlank = useMutation({
    mutationFn: async (template: { id: string; name: string }) => {
      const { data, error } = await supabase.functions.invoke(
        "generate-blank-intake-pdf",
        {
          body: { agreement_id: template.id },
        },
      );
      if (error) throw new Error(error.message ?? String(error));
      // functions.invoke returns either a parsed body or a Blob/ArrayBuffer
      // depending on Content-Type. Coerce to Blob defensively.
      const blob =
        data instanceof Blob
          ? data
          : data instanceof ArrayBuffer
            ? new Blob([data], { type: "application/pdf" })
            : data instanceof Uint8Array
              ? new Blob([data], { type: "application/pdf" })
              : null;
      if (!blob) {
        throw new Error("Could not read PDF response");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugForFilename(template.name ?? "intake-form")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not generate PDF"),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("agreement_templates")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logActivity({
        organization_id: orgId,
        action: "deleted",
        entity_type: "agreement_template",
        entity_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Template archived");
      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Archive failed"),
  });

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Agreement Templates"
          description="Create and manage waivers, liability releases, policies, and service agreements."
        />

        <div className="mb-4 flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" /> New Template
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Template Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : templates.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No agreement templates yet.</TableCell></TableRow>
              ) : (
                templates.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{agreementTypeLabel(t.type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{requiredForLabel(t.required_for)}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">v{t.version}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Print blank form"
                        disabled={printBlank.isPending && printBlank.variables?.id === t.id}
                        onClick={() => printBlank.mutate({ id: t.id, name: t.name })}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm(`Archive "${t.name}"?`)) archive.mutate(t.id);
                        }}
                      >
                        Archive
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AgreementTemplateFormDialog open={open} onOpenChange={setOpen} template={editing} />
    </PortalLayout>
  );
}

// Same shape as the slugForFilename in supabase/functions/generate-blank-intake-pdf —
// kept inline so the client-side download attribute always matches what
// the server's Content-Disposition would produce.
function slugForFilename(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "intake-form"
  );
}
