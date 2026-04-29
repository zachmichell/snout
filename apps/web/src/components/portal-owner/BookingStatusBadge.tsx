import { cn } from "@/lib/utils";

type Status = "requested" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

const styles: Record<Status, { cls: string; label: string }> = {
  requested: { cls: "bg-teal-light text-teal border-teal/30", label: "Requested" },
  confirmed: { cls: "bg-success-light text-success border-success/30", label: "Confirmed" },
  checked_in: { cls: "bg-warning-light text-warning border-warning/30", label: "Checked In" },
  checked_out: { cls: "bg-muted text-muted-foreground border-border", label: "Completed" },
  cancelled: { cls: "bg-danger-light text-danger border-danger/30", label: "Cancelled" },
  no_show: { cls: "border-danger/40 text-danger bg-transparent", label: "No Show" },
};

export default function BookingStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = styles[status as Status] ?? styles.requested;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        s.cls,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
