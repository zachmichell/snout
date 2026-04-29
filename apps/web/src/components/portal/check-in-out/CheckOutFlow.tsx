import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Receipt, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useCheckOut } from "@/hooks/useCheckInOut";
import { LOG_TYPE_LABELS, LogType } from "@/lib/care";
import { formatRelativeShort } from "@/lib/checkin";
import TipDialog from "@/components/portal/TipDialog";

type Props = {
  reservationId: string;
  petName?: string;
  checkedInAt: string | null;
  onDone?: () => void;
  onCancel?: () => void;
};

type Step = "summary" | "confirm";

export default function CheckOutFlow({ reservationId, petName, checkedInAt, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>("summary");
  const [tipOpen, setTipOpen] = useState(false);
  const [savingTip, setSavingTip] = useState(false);
  const checkOut = useCheckOut();

  const { data: summary } = useQuery({
    queryKey: ["checkout-summary", reservationId],
    queryFn: async () => {
      const [{ data: logs }, { data: cards }, { data: invoice }, { data: incidents }] = await Promise.all([
        supabase.from("pet_care_logs").select("log_type").eq("reservation_id", reservationId),
        supabase
          .from("report_cards")
          .select("id, published")
          .eq("reservation_id", reservationId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select("id, invoice_number, status")
          .eq("reservation_id", reservationId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("incidents")
          .select("id")
          .eq("reservation_id", reservationId),
      ]);
      return { logs: logs ?? [], card: cards ?? null, invoice: invoice ?? null, incidents: incidents ?? [] };
    },
  });

  const duration = checkedInAt ? formatRelativeShort(checkedInAt).replace(" ago", "") : "—";
  const logCounts = (["feeding", "play", "potty", "medication", "rest", "note"] as LogType[])
    .map((t) => {
      const n = summary?.logs?.filter((l: any) => l.log_type === t).length ?? 0;
      return n > 0 ? `${n} ${LOG_TYPE_LABELS[t].toLowerCase()}` : null;
    })
    .filter(Boolean)
    .join(", ");

  const finalize = () => {
    checkOut.mutate(
      { reservationId, petName },
      {
        onSuccess: () => {
          if (summary?.card && !summary.card.published) {
            setTimeout(() => {
              const ok = window.confirm("Publish report card now?");
              if (ok && summary.card) {
                supabase
                  .from("report_cards")
                  .update({ published: true, published_at: new Date().toISOString() })
                  .eq("id", summary.card.id)
                  .then();
              }
            }, 200);
          }
          onDone?.();
        },
      },
    );
  };

  const handleTip = async (tipCents: number | null) => {
    setSavingTip(true);
    if (tipCents && tipCents > 0) {
      const { error } = await supabase
        .from("reservations")
        .update({ tip_cents: tipCents })
        .eq("id", reservationId);
      if (error) {
        // Non-fatal — proceed with checkout regardless
        console.warn("Failed to save tip:", error.message);
      }
    }
    setSavingTip(false);
    setTipOpen(false);
    finalize();
  };

  const submit = () => {
    // Open tip dialog before completing checkout (skippable).
    setTipOpen(true);
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-card-alt p-4 text-sm">
      <ol className="mb-4 flex items-center gap-2 text-xs font-semibold text-text-tertiary">
        <span className={`rounded-full px-2 py-0.5 ${step === "summary" ? "bg-primary text-primary-foreground" : "text-success"}`}>
          {step === "summary" ? "1" : "✓"} Summary
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className={`rounded-full px-2 py-0.5 ${step === "confirm" ? "bg-primary text-primary-foreground" : ""}`}>
          2 Confirm
        </span>
      </ol>

      {step === "summary" && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <dt className="text-text-tertiary">Duration</dt>
              <dd className="text-foreground">{duration}</dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Care logs</dt>
              <dd className="text-foreground">{logCounts || "None"}</dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Report card</dt>
              <dd>
                {summary?.card ? (
                  summary.card.published ? (
                    <span className="text-success">Published</span>
                  ) : (
                    <span className="text-warning">Draft</span>
                  )
                ) : (
                  <span className="text-text-tertiary">None</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Invoice</dt>
              <dd>
                {summary?.invoice ? (
                  <Link to={`/invoices/${summary.invoice.id}`} className="text-primary hover:underline">
                    <Receipt className="mr-1 inline h-3 w-3" />
                    {summary.invoice.invoice_number ?? "View"}
                  </Link>
                ) : (
                  <span className="text-text-tertiary">Will be created</span>
                )}
              </dd>
            </div>
            {summary?.incidents && summary.incidents.length > 0 && (
              <div className="col-span-2 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-light px-2 py-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {summary.incidents.length} incident{summary.incidents.length === 1 ? "" : "s"} on file
              </div>
            )}
          </dl>
          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={() => setStep("confirm")}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <p className="text-foreground">
            Check out <span className="font-semibold">{petName ?? "pet"}</span>?
            {!summary?.invoice && (
              <span className="ml-1 text-text-tertiary">An invoice will be created automatically.</span>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep("summary")}>
              Back
            </Button>
            <Button size="sm" onClick={submit} disabled={checkOut.isPending || savingTip}>
              {checkOut.isPending ? "Checking out…" : "Confirm check-out"}
            </Button>
          </div>
        </div>
      )}

      <TipDialog
        open={tipOpen}
        onOpenChange={setTipOpen}
        onConfirm={handleTip}
        title="Add a tip?"
        description={`Optional tip for ${petName ?? "this stay"}. You can skip.`}
        skippable
        confirmLabel="Save tip & check out"
        busy={savingTip || checkOut.isPending}
      />
    </div>
  );
}
