import { cn } from "@/lib/utils";
import type { VaxStatus } from "@/lib/vaccines";

const styles: Record<VaxStatus, { cls: string; label: string }> = {
  current: { cls: "bg-success-light text-success border-success/30", label: "Up to date" },
  expiring: { cls: "bg-warning-light text-warning border-warning/30", label: "Expiring soon" },
  expired: { cls: "bg-danger-light text-danger border-danger/30", label: "Expired" },
  none: { cls: "bg-muted text-muted-foreground border-border", label: "No records" },
};

export default function VaccinationStatusBadge({
  status,
  className,
}: {
  status: VaxStatus;
  className?: string;
}) {
  const s = styles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        s.cls,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function vaccinationRecordStatus(expiresOn: string | null): "current" | "expiring" | "expired" {
  if (!expiresOn) return "current";
  const exp = new Date(expiresOn);
  const now = new Date();
  if (exp < now) return "expired";
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 30);
  if (exp <= cutoff) return "expiring";
  return "current";
}
