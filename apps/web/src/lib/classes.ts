export const CLASS_CATEGORIES = [
  { value: "puppy_socialization", label: "Puppy Socialization" },
  { value: "obedience", label: "Obedience" },
  { value: "agility", label: "Agility" },
  { value: "behavioral", label: "Behavioral" },
  { value: "advanced_training", label: "Advanced Training" },
  { value: "custom", label: "Custom" },
] as const;

export function categoryLabel(value: string): string {
  return CLASS_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayShort(d: number): string {
  return DAYS_SHORT[d] ?? "";
}
export function dayLong(d: number): string {
  return DAYS_LONG[d] ?? "";
}

export function formatScheduleSummary(
  day: number | null | undefined,
  time: string | null | undefined,
): string {
  if (day == null) return "No recurring schedule";
  const t = time ? formatTime12(time) : "";
  return [dayLong(day), t].filter(Boolean).join(" · ");
}

export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

/**
 * Generate the next N upcoming weekly occurrences from `fromDate` for a given
 * day-of-week + HH:MM time. Returns ISO start/end pairs.
 */
export function generateWeeklyOccurrences(
  dayOfWeek: number,
  time: string,
  durationMinutes: number,
  fromDate: Date,
  count: number,
): { start_at: string; end_at: string }[] {
  const [h, m] = time.split(":").map(Number);
  const out: { start_at: string; end_at: string }[] = [];
  const cursor = new Date(fromDate);
  cursor.setHours(h, m ?? 0, 0, 0);
  // Move cursor forward to the next matching day-of-week
  let diff = (dayOfWeek - cursor.getDay() + 7) % 7;
  if (diff === 0 && cursor.getTime() < Date.now()) diff = 7;
  cursor.setDate(cursor.getDate() + diff);
  for (let i = 0; i < count; i++) {
    const start = new Date(cursor);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    out.push({ start_at: start.toISOString(), end_at: end.toISOString() });
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

export function formatInstanceDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function instanceStatusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}

export function enrollmentStatusLabel(status: string): string {
  switch (status) {
    case "enrolled":
      return "Enrolled";
    case "cancelled":
      return "Cancelled";
    case "waitlist":
      return "Waitlist";
    default:
      return status;
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "unpaid":
      return "Unpaid";
    case "refunded":
      return "Refunded";
    default:
      return status;
  }
}
