import StatusBadge from "@/components/portal/StatusBadge";
import { VaxItemStatus, WaiverCheck } from "@/lib/checkin";

export function WaiverBadge({ status }: { status: "signed" | "outdated" | "unsigned" }) {
  if (status === "signed") return <StatusBadge tone="success">Waivers signed</StatusBadge>;
  if (status === "outdated") return <StatusBadge tone="warning">Waivers update required</StatusBadge>;
  return <StatusBadge tone="danger">Waivers unsigned</StatusBadge>;
}

export function VaxBadge({ status }: { status: VaxItemStatus }) {
  if (status === "current") return <StatusBadge tone="success">Vaccines current</StatusBadge>;
  if (status === "expiring") return <StatusBadge tone="warning">Vaccines expiring</StatusBadge>;
  if (status === "missing") return <StatusBadge tone="warning">Vaccines missing</StatusBadge>;
  return <StatusBadge tone="danger">Vaccines expired</StatusBadge>;
}

export function WaiverList({ items }: { items: WaiverCheck[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-text-tertiary">No active waivers configured.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((w) => (
        <li key={w.waiver_id} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-foreground">{w.title}</span>
          {w.status === "signed" ? (
            <span className="text-success">✓ Signed v{w.signed_version}</span>
          ) : w.status === "outdated" ? (
            <span className="text-warning">⚠ Update required (v{w.signed_version} → v{w.current_version})</span>
          ) : (
            <span className="text-destructive">✗ Unsigned</span>
          )}
        </li>
      ))}
    </ul>
  );
}
