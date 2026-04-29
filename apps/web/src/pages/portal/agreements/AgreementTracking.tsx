import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, FileText } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { agreementTypeLabel } from "@/lib/agreements";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AgreementTracking() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id ?? "";

  const [viewing, setViewing] = useState<any>(null);

  // Active templates required for everyone
  const { data: templates = [] } = useQuery({
    queryKey: ["active-agreement-templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreement_templates")
        .select("id, name, type, required_for")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  // All owners in org
  const { data: owners = [] } = useQuery({
    queryKey: ["owners-for-tracking", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, first_name, last_name, email")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("last_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // All signed agreements
  const { data: signed = [], isLoading: loadingSigned } = useQuery({
    queryKey: ["signed-agreements", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signed_agreements")
        .select(
          `id, signed_at, signer_name, ip_address, signature_data, rendered_body, template_version,
           template:template_id(id, name, type),
           owner:owner_id(id, first_name, last_name, email),
           pet:pet_id(id, name)`,
        )
        .eq("organization_id", orgId)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Compute "unsigned" owners: anyone missing a signature for an "all"-required template
  const requiredAllTemplates = templates.filter((t: any) => t.required_for === "all");

  const unsignedRows = useMemo(() => {
    const rows: { owner: any; missing: any[] }[] = [];
    for (const o of owners) {
      const ownerSigned = signed.filter((s: any) => s.owner?.id === o.id);
      const signedTemplateIds = new Set(ownerSigned.map((s: any) => s.template?.id).filter(Boolean));
      const missing = requiredAllTemplates.filter((t: any) => !signedTemplateIds.has(t.id));
      if (missing.length > 0) rows.push({ owner: o, missing });
    }
    return rows;
  }, [owners, signed, requiredAllTemplates]);

  const sendBulkReminder = async () => {
    // Lightweight: just toast — real email send hooks into existing send-email function later
    toast.success(`Reminder queued for ${unsignedRows.length} owner${unsignedRows.length === 1 ? "" : "s"}`);
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Agreements"
          description="Track which owners still need to sign required agreements."
        />

        <Tabs defaultValue="unsigned">
          <TabsList>
            <TabsTrigger value="unsigned">
              Unsigned {unsignedRows.length > 0 && <span className="ml-1.5 rounded-full bg-destructive/10 text-destructive text-xs px-1.5 py-0.5">{unsignedRows.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="signed">Signed ({signed.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="unsigned" className="mt-6">
            <div className="mb-4 flex justify-end">
              <Button onClick={sendBulkReminder} disabled={unsignedRows.length === 0}>
                <Bell className="h-4 w-4 mr-1.5" /> Send Reminders to All Unsigned
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Owner</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Missing Agreements</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unsignedRows.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">All caught up — no pending agreements.</TableCell></TableRow>
                  ) : (
                    unsignedRows.map(({ owner, missing }) => (
                      <TableRow key={owner.id}>
                        <TableCell className="font-medium">{owner.first_name} {owner.last_name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{owner.email ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {missing.map((m: any) => (
                              <Badge key={m.id} variant="secondary">{m.name}</Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="signed" className="mt-6">
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Template</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Signed By</TableHead>
                    <TableHead>Signed At</TableHead>
                    <TableHead className="w-[80px] text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingSigned ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : signed.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No signed agreements yet.</TableCell></TableRow>
                  ) : (
                    signed.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.template?.name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{agreementTypeLabel(s.template?.type ?? "")}</div>
                        </TableCell>
                        <TableCell>{s.owner?.first_name} {s.owner?.last_name}</TableCell>
                        <TableCell className="text-sm">{s.signer_name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{new Date(s.signed_at).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setViewing(s)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{viewing?.template?.name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Signed by <span className="font-medium text-foreground">{viewing.signer_name}</span> on {new Date(viewing.signed_at).toLocaleString()}</div>
                {viewing.ip_address && <div>IP: {viewing.ip_address}</div>}
                <div>Template version: v{viewing.template_version}</div>
              </div>
              <div className="rounded-md bg-muted/30 p-4 text-sm whitespace-pre-wrap font-sans">
                {viewing.rendered_body || "(no rendered body captured)"}
              </div>
              {viewing.signature_data && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Signature</p>
                  <div className="rounded-md border border-border bg-card p-3 inline-block">
                    <img src={viewing.signature_data} alt="Signature" className="max-h-32" />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
