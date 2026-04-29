import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
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
