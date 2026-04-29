// Helpers for weekly recurring reservations.
// Days of week: 0 = Sunday, 1 = Monday … 6 = Saturday (matches JS Date.getDay()).

export const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LABELS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type EndsKind = "never" | "after" | "on";

export type RecurrenceConfig = {
  daysOfWeek: number[]; // 0..6
  startDate: string; // YYYY-MM-DD
  endsKind: EndsKind;
  occurrencesCount?: number; // when endsKind === "after"
  endDate?: string; // YYYY-MM-DD when endsKind === "on"
};

/** Combine a YYYY-MM-DD date string and a HH:mm time string into a local Date. */
export function combineDateTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

/** Return YYYY-MM-DD in local TZ. */
export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Return HH:mm in local TZ. */
export function toTimeOnly(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Generate the list of occurrence start-dates for a weekly schedule.
 * Caller pairs each date with start_time / end_time to build full reservations.
 */
export function generateOccurrenceDates(cfg: RecurrenceConfig, hardCap = 365): string[] {
  if (cfg.daysOfWeek.length === 0 || !cfg.startDate) return [];

  const start = combineDateTime(cfg.startDate, "00:00");
  const out: string[] = [];

  const cap =
    cfg.endsKind === "after" && cfg.occurrencesCount && cfg.occurrencesCount > 0
      ? Math.min(cfg.occurrencesCount, hardCap)
      : hardCap;

  const endBoundary =
    cfg.endsKind === "on" && cfg.endDate ? combineDateTime(cfg.endDate, "23:59") : null;

  // Default safety horizon for "never": 26 weeks from start.
  const neverHorizon = new Date(start);
  neverHorizon.setDate(neverHorizon.getDate() + 26 * 7);

  const cursor = new Date(start);
  while (out.length < cap) {
    if (endBoundary && cursor > endBoundary) break;
    if (cfg.endsKind === "never" && cursor > neverHorizon) break;

    if (cfg.daysOfWeek.includes(cursor.getDay())) {
      out.push(toDateOnly(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);

    // Hard safety brake.
    if (out.length === 0 && cursor.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1000) break;
  }
  return out;
}

/** Human label for a day-of-week schedule. */
export function describeSchedule(daysOfWeek: number[]): string {
  if (!daysOfWeek || daysOfWeek.length === 0) return "—";
  const sorted = [...daysOfWeek].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5)) return "Weekdays";
  if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return "Weekends";
  return "Every " + sorted.map((d) => DAY_LABELS_SHORT[d]).join(" & ");
}
