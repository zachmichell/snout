import { isExpired, isExpiringSoon } from "./format";

export type VaxItemStatus = "current" | "expiring" | "expired" | "missing";

export type VaxRecord = {
  vaccine_type: string;
  expires_on: string | null;
};

const REQUIRED: Record<string, string[]> = {
  dog: ["rabies", "dhpp", "bordetella"],
  cat: ["rabies", "fvrcp"],
};

export type VaxCheck = { type: string; status: VaxItemStatus; expires_on: string | null };

/**
 * Validate a pet's vaccinations:
 *  - Each existing record gets a status (current / expiring / expired)
 *  - Any required vaccines for the species with NO record → "missing"
 */
export function validateVaccinations(
  species: string | null | undefined,
  records: VaxRecord[] | null | undefined,
): VaxCheck[] {
  const result: VaxCheck[] = [];
  const recs = records ?? [];

  for (const r of recs) {
    let status: VaxItemStatus = "current";
    if (isExpired(r.expires_on)) status = "expired";
    else if (isExpiringSoon(r.expires_on)) status = "expiring";
    result.push({ type: r.vaccine_type, status, expires_on: r.expires_on });
  }

  const required = REQUIRED[species ?? ""] ?? [];
  for (const req of required) {
    if (!recs.some((r) => r.vaccine_type === req)) {
      result.push({ type: req, status: "missing", expires_on: null });
    }
  }

  return result;
}

export function vaxOverallStatus(checks: VaxCheck[]): VaxItemStatus {
  if (checks.some((c) => c.status === "expired")) return "expired";
  if (checks.some((c) => c.status === "missing")) return "missing";
  if (checks.some((c) => c.status === "expiring")) return "expiring";
  if (checks.length === 0) return "missing";
  return "current";
}

export type WaiverCheck = {
  waiver_id: string;
  title: string;
  current_version: number;
  signed_version: number | null;
  status: "signed" | "outdated" | "unsigned";
};

export function validateWaivers(
  activeWaivers: { id: string; title: string; version: number }[] | null | undefined,
  signatures: { waiver_id: string; waiver_version: number }[] | null | undefined,
): WaiverCheck[] {
  const latest = new Map<string, number>();
  for (const s of signatures ?? []) {
    const cur = latest.get(s.waiver_id) ?? -1;
    if (s.waiver_version > cur) latest.set(s.waiver_id, s.waiver_version);
  }
  return (activeWaivers ?? []).map((w) => {
    const v = latest.get(w.id);
    let status: WaiverCheck["status"] = "unsigned";
    if (v === undefined) status = "unsigned";
    else if (v < w.version) status = "outdated";
    else status = "signed";
    return { waiver_id: w.id, title: w.title, current_version: w.version, signed_version: v ?? null, status };
  });
}

export function waiverOverallStatus(checks: WaiverCheck[]): "signed" | "outdated" | "unsigned" {
  if (checks.length === 0) return "signed";
  if (checks.some((c) => c.status === "unsigned")) return "unsigned";
  if (checks.some((c) => c.status === "outdated")) return "outdated";
  return "signed";
}

/** Format a relative "x min/h ago" for short timestamps. */
export function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
