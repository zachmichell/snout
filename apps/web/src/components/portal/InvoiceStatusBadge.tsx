import { InvoiceDisplayStatus } from "@/lib/invoice";

const map: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-card-alt text-text-secondary border-border" },
  sent: { label: "Sent", cls: "bg-frost-bg text-foreground border-frost/40" },
  paid: { label: "Paid", cls: "bg-mist-bg text-success border-mist/40" },
  partial: { label: "Partial", cls: "bg-vanilla-bg text-foreground border-vanilla/40" },
  overdue: { label: "Overdue", cls: "bg-destructive-light text-destructive border-destructive/30" },
  void: { label: "Void", cls: "bg-card text-text-tertiary border-border line-through" },
};

export default function InvoiceStatusBadge({
  status,
  size = "sm",
}: {
  status: InvoiceDisplayStatus | string;
  size?: "sm" | "lg";
}) {
  const m = map[status] ?? map.draft;
  const padding = size === "lg" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border font-semibold ${padding} ${m.cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {m.label}
    </span>
  );
}
