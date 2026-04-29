import StatusBadge from "./StatusBadge";
import { formatReservationStatus } from "@/lib/money";

export default function ReservationStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  let tone: "primary" | "teal" | "success" | "muted" | "danger" | "warning" = "muted";
  switch (status) {
    case "requested":
      tone = "primary"; // Soft Camel
      break;
    case "confirmed":
      tone = "teal"; // Frosted Glass
      break;
    case "checked_in":
      tone = "success"; // Morning Mist green
      break;
    case "checked_out":
      tone = "muted";
      break;
    case "cancelled":
      tone = "danger";
      break;
    case "no_show":
      tone = "warning";
      break;
  }
  return (
    <StatusBadge tone={tone} className={className}>
      {formatReservationStatus(status)}
    </StatusBadge>
  );
}
