export const TIMEZONE_BY_COUNTRY: Record<string, string> = {
  CA: "America/Regina",
  US: "America/New_York",
};

export const TIMEZONE_OPTIONS = [
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Toronto",
  "America/Halifax",
  "America/St_Johns",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export const CURRENCY_BY_COUNTRY: Record<string, "CAD" | "USD"> = {
  CA: "CAD",
  US: "USD",
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
