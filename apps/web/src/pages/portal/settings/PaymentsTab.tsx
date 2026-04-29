// Processor picker. The org chooses one payment processor at a time
// (Stripe or Helcim), and we render the corresponding panel underneath.
//
// `selected` is local UI state; the *active* processor is read from the
// organizations row via useOrgProcessor. When they diverge (operator
// clicked the other tab to attach a new processor), we keep showing the
// new tab so the attach flow is uninterrupted, and the active processor
// flips on the server only after a successful attach.
import { useEffect, useState } from "react";
import { CreditCard, KeyRound } from "lucide-react";
import { useOrgProcessor, type ProcessorKind } from "@/hooks/useOrgProcessor";
import StripePanel from "./payments/StripePanel";
import HelcimPanel from "./payments/HelcimPanel";

export default function PaymentsTab() {
  const { data: active, isLoading } = useOrgProcessor();
  const [selected, setSelected] = useState<ProcessorKind>("stripe");

  // Default the picker to whatever the org is currently using. If the
  // operator switches manually we keep their choice until they leave the
  // tab — useEffect dependency on `active` only re-anchors when the
  // server-side processor changes (e.g. after a successful attach).
  useEffect(() => {
    if (active) setSelected(active);
  }, [active]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg text-foreground">Payment processor</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Choose where customer payments settle. Each organization uses one processor at
          a time. Stripe Connect is the default; Helcim is a Canadian alternative with
          interchange-plus pricing and native Interac support.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ProcessorCard
          kind="stripe"
          title="Stripe Connect"
          description="Card and ACH worldwide. OAuth onboarding, no token to manage."
          icon={<CreditCard className="h-5 w-5" />}
          active={active === "stripe"}
          selected={selected === "stripe"}
          onSelect={() => setSelected("stripe")}
          loading={isLoading}
        />
        <ProcessorCard
          kind="helcim"
          title="Helcim"
          description="Interchange-plus pricing, Interac and Canadian debit. API-token attach."
          icon={<KeyRound className="h-5 w-5" />}
          active={active === "helcim"}
          selected={selected === "helcim"}
          onSelect={() => setSelected("helcim")}
          loading={isLoading}
        />
      </div>

      {selected === "stripe" ? <StripePanel /> : <HelcimPanel />}
    </div>
  );
}

function ProcessorCard({
  title,
  description,
  icon,
  active,
  selected,
  onSelect,
  loading,
}: {
  kind: ProcessorKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group flex items-start gap-3 rounded-lg border p-4 text-left transition",
        selected
          ? "border-accent bg-accent-light/40 ring-1 ring-accent"
          : "border-border bg-surface hover:border-border-strong",
      ].join(" ")}
    >
      <div
        className={[
          "rounded-md p-2",
          selected ? "bg-accent text-white" : "bg-background text-text-secondary",
        ].join(" ")}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{title}</span>
          {active && (
            <span className="rounded-full border border-success/30 bg-mist-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-success">
              Active
            </span>
          )}
          {loading && (
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
              ...
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-secondary">{description}</p>
      </div>
    </button>
  );
}
