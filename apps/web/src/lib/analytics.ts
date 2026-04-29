import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { addDays, differenceInCalendarDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";

export const APP_TZ = "America/Edmonton";

export type RangePreset = "today" | "7d" | "30d" | "this_month" | "last_month" | "custom";

export type DateRange = { from: Date; to: Date; label: string };

/** Returns from/to as UTC Date instances representing the start/end of the requested range in APP_TZ. */
export function getDateRange(preset: RangePreset, custom?: { from: Date; to: Date }): DateRange {
  const nowZoned = toZonedTime(new Date(), APP_TZ);
  const todayStartZ = startOfDay(nowZoned);
  const todayEndZ = endOfDay(nowZoned);

  let fromZ: Date;
  let toZ: Date;
  let label = "";

  switch (preset) {
    case "today":
      fromZ = todayStartZ;
      toZ = todayEndZ;
      label = "Today";
      break;
    case "7d":
      fromZ = startOfDay(addDays(todayStartZ, -6));
      toZ = todayEndZ;
      label = "Last 7 Days";
      break;
    case "30d":
      fromZ = startOfDay(addDays(todayStartZ, -29));
      toZ = todayEndZ;
      label = "Last 30 Days";
      break;
    case "this_month":
      fromZ = startOfMonth(nowZoned);
      toZ = todayEndZ;
      label = "This Month";
      break;
    case "last_month": {
      const lm = subMonths(nowZoned, 1);
      fromZ = startOfMonth(lm);
      toZ = endOfMonth(lm);
      label = "Last Month";
      break;
    }
    case "custom":
      fromZ = startOfDay(toZonedTime(custom?.from ?? nowZoned, APP_TZ));
      toZ = endOfDay(toZonedTime(custom?.to ?? nowZoned, APP_TZ));
      label = "Custom Range";
      break;
  }

  return {
    from: fromZoned(fromZ),
    to: fromZoned(toZ),
    label,
  };
}

function fromZoned(zonedDate: Date): Date {
  // Re-interpret a zoned wall-clock time as UTC instant
  return fromZonedTime(zonedDate, APP_TZ);
}

/** Previous equivalent period of the same length, ending right before `from`. */
export function getPreviousRange(range: DateRange): DateRange {
  const ms = range.to.getTime() - range.from.getTime();
  const prevTo = new Date(range.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - ms);
  return { from: prevFrom, to: prevTo, label: "Previous period" };
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Format a date as YYYY-MM-DD in APP_TZ. */
export function dayKey(d: Date): string {
  return formatInTimeZone(d, APP_TZ, "yyyy-MM-dd");
}

export function dayLabel(d: Date): string {
  return formatInTimeZone(d, APP_TZ, "MMM d");
}

/** Returns ordered array of day keys from from..to inclusive (APP_TZ days). */
export function eachDayInRange(range: DateRange): { key: string; date: Date; label: string }[] {
  const out: { key: string; date: Date; label: string }[] = [];
  const totalDays = differenceInCalendarDays(
    toZonedTime(range.to, APP_TZ),
    toZonedTime(range.from, APP_TZ),
  );
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(toZonedTime(range.from, APP_TZ), i);
    const utc = fromZonedTime(d, APP_TZ);
    out.push({ key: dayKey(utc), date: utc, label: dayLabel(utc) });
  }
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDERED = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const idx = Number(formatInTimeZone(date, APP_TZ, "i")); // 1=Mon..7=Sun
  return ORDERED[idx - 1];
}

export const WEEKDAY_ORDER = ORDERED;

export function formatMoney(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
