import { useCallback, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerRecord } from "@/hooks/useOwnerRecord";
import { useOwnerWaiver } from "@/hooks/useOwnerWaivers";
import { formatDate } from "@/lib/format";
import SignaturePad, { type SignaturePayload } from "@/components/portal-owner/SignaturePad";

function looksLikeHtml(s: string) {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

export default function OwnerWaiverDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { membership } = useAuth();
  const { data: owner } = useOwnerRecord();
  const { data: waiver, isLoading, error } = useOwnerWaiver(id);

  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<SignaturePayload | null>(null);

  const handleSigChange = useCallback((p: SignaturePayload | null) => setSignature(p), []);

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!waiver || !owner || !membership) throw new Error("Missing context");
      if (!signature) throw new Error("Please provide your signature");
      const { error: insertErr } = await supabase.from("waiver_signatures").insert({
        organization_id: membership.organization_id,
        waiver_id: waiver.id,
        waiver_version: waiver.version,
        owner_id: owner.id,
        signed_at: new Date().toISOString(),
        signature_data: signature.value,
        user_agent: navigator.userAgent,
      });
      if (insertErr) throw insertErr;

      try {
        const { logActivity } = await import("@/lib/activity");
        const ownerName = `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() || "Owner";
        await logActivity({
          organization_id: membership.organization_id,
          entity_type: "waiver_signature",
          entity_id: waiver.id,
          action: "signed",
          metadata: {
            owner_id: owner.id,
            waiver_id: waiver.id,
            waiver_version: waiver.version,
            method: signature.method,
            summary: `${ownerName} signed waiver: ${waiver.title ?? waiver.id}`,
          },
          actor: { kind: "owner", label: "Owner" },
        });
      } catch (logErr) {
        console.warn("activity_log write failed", logErr);
      }
    },
    onSuccess: () => {
      toast.success("Waiver signed successfully");
      qc.invalidateQueries({ queryKey: ["owner-waivers-list"] });
      qc.invalidateQueries({ queryKey: ["owner-waiver"] });
      qc.invalidateQueries({ queryKey: ["owner-waivers-alert"] });
      navigate("/portal/waivers");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to sign waiver"),
  });

  if (isLoading) {
    return <div className="text-center text-sm text-muted-foreground">Loading waiver…</div>;
  }
  if (error || !waiver) {
    return <Navigate to="/portal/waivers" replace />;
  }

  const isSignedCurrent = waiver.status === "signed";
  const body = waiver.body ?? "";
  const isHtml = looksLikeHtml(body);

  return (
    <div>
      <Link
        to="/portal/waivers"
        className="mb-6 inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to waivers
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold text-foreground">{waiver.title}</h1>
          <span className="inline-flex items-center rounded-pill border border-border bg-card-alt px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Version {waiver.version}
          </span>
        </div>
      </header>

      {isSignedCurrent && (
        <div className="mb-6 rounded-xl border border-mist/40 bg-mist-bg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            <div>
              <p className="font-semibold text-success">
                You signed this waiver on {formatDate(waiver.signed_at)}
              </p>
              <p className="mt-0.5 text-sm text-foreground/80">
                Version {waiver.signed_version}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Waiver body */}
      <article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="max-h-[60vh] overflow-y-auto pr-2">
          {isHtml ? (
            <div
              className="prose prose-sm max-w-none text-foreground"
              // Sanitized with DOMPurify to prevent stored XSS from malicious waiver bodies.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(body, { USE_PROFILES: { html: true } }),
              }}
            />
          ) : (
            <div className="prose prose-sm max-w-none text-foreground prose-headings:font-display prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
              <ReactMarkdown>{body}</ReactMarkdown>
            </div>
          )}
        </div>
      </article>

      {/* Signed-state preview */}
      {isSignedCurrent && waiver.signature_data && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your signature
          </p>
          <div className="mt-3">
            {waiver.signature_data.startsWith("data:image") ? (
              <img
                src={waiver.signature_data}
                alt="Your signature"
                className="max-h-[120px] rounded border border-border-subtle bg-background p-2"
              />
            ) : (
              <p
                className="text-3xl text-foreground"
                style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic" }}
              >
                {waiver.signature_data}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Signing form */}
      {!isSignedCurrent && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="font-display text-xl font-semibold text-foreground">Your Signature</h2>
          <div className="mt-4">
            <SignaturePad onChange={handleSigChange} />
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border-subtle bg-card-alt p-4">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(c) => setAgreed(c === true)}
              className="mt-0.5"
            />
            <Label htmlFor="agree" className="cursor-pointer text-sm leading-relaxed text-foreground">
              I have read and agree to the terms of this {waiver.title}.
            </Label>
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              size="lg"
              onClick={() => signMutation.mutate()}
              disabled={!agreed || !signature || signMutation.isPending}
            >
              {signMutation.isPending ? "Signing…" : "Sign Waiver"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
