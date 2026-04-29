import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { agreementTypeLabel, renderTemplate } from "@/lib/agreements";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SignaturePad, { SignaturePayload } from "@/components/portal-owner/SignaturePad";

export default function OwnerAgreements() {
  const qc = useQueryClient();
  const { membership, profile } = useAuth();
  const orgId = membership?.organization_id ?? "";
  const { data: owner } = useOwnerRecord();

  const [signing, setSigning] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [sig, setSig] = useState<SignaturePayload | null>(null);

  const { data: org } = useQuery({
    queryKey: ["org-name-for-agreement", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      return data;
    },
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["owner-agreement-templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreement_templates")
        .select("*")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: signed = [], isLoading: loadingSigned } = useQuery({
    queryKey: ["owner-signed-agreements", owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signed_agreements")
        .select("id, signed_at, signer_name, rendered_body, signature_data, template:template_id(id, name, type)")
        .eq("owner_id", owner!.id)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const signedTemplateIds = useMemo(() => new Set(signed.map((s: any) => s.template?.id).filter(Boolean)), [signed]);

  // Pending = active templates required for "all" that this owner hasn't signed yet
  const pending = templates.filter(
    (t: any) => t.required_for === "all" && !signedTemplateIds.has(t.id),
  );
  const optional = templates.filter(
    (t: any) => t.required_for !== "all" && !signedTemplateIds.has(t.id),
  );

  const ownerName = owner ? `${owner.first_name} ${owner.last_name}` : (profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() : "");

  const submitSign = useMutation({
    mutationFn: async () => {
      if (!owner?.id || !orgId) throw new Error("Not signed in");
      if (!signing) throw new Error("No template");
      if (!sig) throw new Error("Please add your signature");
      const signerName = sig.method === "type" ? sig.value : ownerName;
      const signatureData = sig.method === "draw" ? sig.value : await typedSignatureToImage(sig.value);
      const renderedBody = renderTemplate(signing.body, {
        owner_name: ownerName,
        date: new Date().toLocaleDateString(),
        business_name: org?.name ?? "",
      });
      const { data: inserted, error } = await supabase
        .from("signed_agreements")
        .insert({
          organization_id: orgId,
          template_id: signing.id,
          template_version: signing.version ?? 1,
          owner_id: owner.id,
          signer_name: signerName,
          signature_data: signatureData,
          rendered_body: renderedBody,
          user_agent: navigator.userAgent,
        })
        .select("id")
        .single();
      if (error) throw error;

      try {
        const { logActivity } = await import("@/lib/activity");
        await logActivity({
          organization_id: orgId,
          action: "signed",
          entity_type: "agreement",
          entity_id: inserted?.id ?? null,
          metadata: {
            owner_id: owner.id,
            template_id: signing.id,
            template_name: signing.name ?? null,
            signer_name: signerName,
            summary: `${signerName} signed: ${signing.name ?? "agreement"}`,
          },
          actor: { kind: "owner", label: "Owner" },
        });
      } catch (logErr) {
        console.warn("activity_log write failed", logErr);
      }
    },
    onSuccess: () => {
      toast.success("Agreement signed — thank you!");
      qc.invalidateQueries({ queryKey: ["owner-signed-agreements"] });
      setSigning(null);
      setSig(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not save signature"),
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-foreground flex items-center gap-2">
          <FileSignature className="h-6 w-6" /> Agreements
        </h1>
        <p className="mt-1 text-sm text-foreground/70">Review and sign required documents from {org?.name ?? "the business"}.</p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <span className="ml-1.5 rounded-full bg-destructive/10 text-destructive text-xs px-1.5 py-0.5">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="optional">Optional ({optional.length})</TabsTrigger>
          <TabsTrigger value="signed">Signed ({signed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          {loadingTemplates ? (
            <Skeleton />
          ) : pending.length === 0 ? (
            <Empty message="No pending agreements. You're all set!" />
          ) : (
            <div className="space-y-3">
              {pending.map((t: any) => (
                <AgreementCard key={t.id} template={t} onSign={() => { setSigning(t); setSig(null); }} pending />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="optional" className="mt-6">
          {optional.length === 0 ? (
            <Empty message="No optional agreements available." />
          ) : (
            <div className="space-y-3">
              {optional.map((t: any) => (
                <AgreementCard key={t.id} template={t} onSign={() => { setSigning(t); setSig(null); }} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="signed" className="mt-6">
          {loadingSigned ? (
            <Skeleton />
          ) : signed.length === 0 ? (
            <Empty message="You haven't signed any agreements yet." />
          ) : (
            <div className="space-y-3">
              {signed.map((s: any) => (
                <div key={s.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{s.template?.name ?? "—"}</div>
                    <div className="text-xs text-foreground/60 mt-0.5 flex items-center gap-2">
                      <Badge variant="secondary">{agreementTypeLabel(s.template?.type ?? "")}</Badge>
                      <span>Signed {new Date(s.signed_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setViewing(s)}>View</Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sign dialog */}
      <Dialog open={!!signing} onOpenChange={(o) => { if (!o) { setSigning(null); setSig(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{signing?.name}</DialogTitle>
          </DialogHeader>
          {signing && (
            <div className="space-y-4">
              <Badge variant="secondary">{agreementTypeLabel(signing.type)}</Badge>
              <div className="rounded-md bg-muted/30 p-4 text-sm whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
                {renderTemplate(signing.body, {
                  owner_name: ownerName,
                  date: new Date().toLocaleDateString(),
                  business_name: org?.name ?? "",
                })}
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-sm font-semibold mb-2">Sign below</p>
                <SignaturePad onChange={setSig} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSigning(null); setSig(null); }}>Cancel</Button>
            <Button onClick={() => submitSign.mutate()} disabled={!sig || submitSign.isPending}>
              {submitSign.isPending ? "Signing…" : (
                <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm & Sign</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View signed dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{viewing?.template?.name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60">Signed by {viewing.signer_name} on {new Date(viewing.signed_at).toLocaleString()}</div>
              <div className="rounded-md bg-muted/30 p-4 text-sm whitespace-pre-wrap">{viewing.rendered_body}</div>
              {viewing.signature_data && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground/60 mb-2">Your signature</p>
                  <div className="rounded-md border border-border bg-card p-3 inline-block">
                    <img src={viewing.signature_data} alt="Signature" className="max-h-32" />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgreementCard({ template, onSign, pending }: { template: any; onSign: () => void; pending?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{template.name}</span>
          <Badge variant="secondary">{agreementTypeLabel(template.type)}</Badge>
          {pending && <Badge variant="destructive">Required</Badge>}
        </div>
        <p className="text-xs text-foreground/60 mt-1 line-clamp-2">{template.body?.slice(0, 160) || "No description provided."}</p>
      </div>
      <Button onClick={onSign}>
        <FileSignature className="h-4 w-4 mr-1.5" /> Read & Sign
      </Button>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-foreground/60">{message}</div>
  );
}

function Skeleton() {
  return <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-foreground/60">Loading…</div>;
}

/** Render a typed name into a small PNG so we always store a signature image. */
function typedSignatureToImage(name: string): Promise<string> {
  return new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 150;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#362C26";
    ctx.font = "italic 56px 'Fraunces', serif";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 20, c.height / 2);
    resolve(c.toDataURL("image/png"));
  });
}
