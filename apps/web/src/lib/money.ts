export function formatCents(cents: number | null | undefined, currency: string = "CAD") {
  const v = (Number(cents ?? 0) / 100).toFixed(2);
  return `$${v} ${currency}`;
}

export function formatCentsShort(cents: number | null | undefined) {
  const v = (Number(cents ?? 0) / 100).toFixed(2);
  return `$${v}`;
}

/** Parse a user-entered dollar amount like "52.50" into integer cents (5250). Returns null on invalid. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (Number(cents) / 100).toFixed(2);
}

export function formatDurationType(t: string): string {
  const map: Record<string, string> = {
    hourly: "Hourly",
    half_day: "Half Day",
    full_day: "Full Day",
    overnight: "Overnight",
    multi_night: "Multi-Night",
  };
  return map[t] ?? t;
}

export function formatModule(m: string): string {
  const map: Record<string, string> = {
    daycare: "Daycare",
    boarding: "Boarding",
    grooming: "Grooming",
    training: "Training",
    retail: "Retail",
  };
  return map[m] ?? m;
}

export function formatReservationStatus(s: string): string {
  const map: Record<string, string> = {
    requested: "Requested",
    confirmed: "Confirmed",
    checked_in: "Checked In",
    checked_out: "Checked Out",
    cancelled: "Cancelled",
    no_show: "No Show",
  };
  return map[s] ?? s;
}

export function formatDateTime(value: string | Date | null | undefined, timezone?: string) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString(undefined, {
    timeZone: timezone || undefined,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(value: string | Date | null | undefined, timezone?: string) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString(undefined, {
    timeZone: timezone || undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Build a default end_at from a start_at string (datetime-local) and a duration_type. */
export function computeEndFromStart(startISO: string, durationType: string): string {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return startISO;
  const end = new Date(start);
  switch (durationType) {
    case "hourly":
      end.setHours(end.getHours() + 1);
      break;
    case "half_day":
      end.setHours(end.getHours() + 5);
      break;
    case "full_day":
      end.setHours(end.getHours() + 10);
      break;
    case "overnight":
      end.setDate(end.getDate() + 1);
      end.setHours(8, 0, 0, 0);
      break;
    case "multi_night":
      end.setDate(end.getDate() + 1);
      break;
    default:
      end.setHours(end.getHours() + 1);
  }
  // Format as datetime-local string
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

/** Convert a Date or ISO to a value usable in <input type="datetime-local"> */
export function toDatetimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
