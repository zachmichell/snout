/**
 * Booking helpers: time slots, duration math, price estimates.
 */

export type DurationType = "hourly" | "half_day" | "full_day" | "overnight" | "multi_night";

/** Generate 15-minute time options between two hours (inclusive of both). */
export function generateTimeSlots(startHour = 6, endHour = 21): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === endHour && m > 0) break;
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const period = h < 12 ? "AM" : "PM";
      const display = h % 12 === 0 ? 12 : h % 12;
      out.push({ value, label: `${display}:${mm} ${period}` });
    }
  }
  return out;
}

/** Combine a yyyy-mm-dd date and HH:mm time into a local Date. */
export function combineDateTime(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
}

/** Get tomorrow's date string yyyy-mm-dd. */
export function tomorrowISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function diffNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + "T00:00:00");
  const b = new Date(checkOut + "T00:00:00");
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/** Estimate total price in cents. */
export function estimatePriceCents(args: {
  basePriceCents: number;
  durationType: DurationType;
  petCount: number;
  nights?: number;
  hours?: number;
}): number {
  const { basePriceCents, durationType, petCount, nights = 1, hours = 1 } = args;
  const pets = Math.max(1, petCount);
  switch (durationType) {
    case "hourly":
      return basePriceCents * Math.max(1, hours) * pets;
    case "half_day":
    case "full_day":
      return basePriceCents * pets;
    case "overnight":
      return basePriceCents * pets;
    case "multi_night":
      return basePriceCents * Math.max(1, nights) * pets;
    default:
      return basePriceCents * pets;
  }
}

export function priceUnitLabel(durationType: DurationType): string {
  switch (durationType) {
    case "hourly":
      return "/hr";
    case "half_day":
      return "/half day";
    case "full_day":
      return "/day";
    case "overnight":
      return "/night";
    case "multi_night":
      return "/night";
    default:
      return "";
  }
}
