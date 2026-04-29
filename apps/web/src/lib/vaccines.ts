import { isExpired, isExpiringSoon } from "./format";

export type VaxStatus = "current" | "expiring" | "expired" | "none";

export type VaxRecord = { expires_on: string | null };

export function getVaccinationStatus(records: VaxRecord[] | null | undefined): VaxStatus {
  if (!records || records.length === 0) return "none";
  if (records.some((r) => isExpired(r.expires_on))) return "expired";
  if (records.some((r) => isExpiringSoon(r.expires_on))) return "expiring";
  return "current";
}

export function lbsToKg(lbs: number | string | null | undefined): number | null {
  if (lbs == null || lbs === "") return null;
  const n = Number(lbs);
  if (Number.isNaN(n)) return null;
  return Number((n / 2.20462).toFixed(3));
}

export const VACCINE_TYPES = [
  { value: "rabies", label: "Rabies" },
  { value: "dapp", label: "DAPP" },
  { value: "dhpp", label: "DHPP" },
  { value: "bordetella", label: "Bordetella" },
  { value: "lepto", label: "Leptospirosis" },
  { value: "lyme", label: "Lyme" },
  { value: "influenza", label: "Influenza" },
  { value: "fvrcp", label: "FVRCP" },
  { value: "other", label: "Other" },
] as const;
