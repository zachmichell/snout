// Duplicate detection helpers for owners and pets.
// Pure functions — no DB calls. Caller fetches records and feeds them in.

export type Confidence = "high" | "medium" | "low";

export type OwnerRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  street_address?: string | null;
  city?: string | null;
  created_at: string;
  pet_count?: number;
  reservation_count?: number;
};

export type PetRecord = {
  id: string;
  name: string | null;
  species: string | null;
  breed: string | null;
  date_of_birth: string | null;
  created_at: string;
  owner_ids: string[];
  owner_names: string[];
};

export type DuplicateGroup<T> = {
  key: string;
  confidence: Confidence;
  reason: string;
  records: T[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Find duplicate groups across owners.
 * Returns array of groups, each with a confidence and a list of matched records.
 */
export function findOwnerDuplicates(
  owners: OwnerRecord[],
  dismissedPairs: Set<string>,
): DuplicateGroup<OwnerRecord>[] {
  const groups = new Map<string, DuplicateGroup<OwnerRecord>>();
  const addToGroup = (
    key: string,
    confidence: Confidence,
    reason: string,
    recs: OwnerRecord[],
  ) => {
    if (recs.length < 2) return;
    const existing = groups.get(key);
    if (existing) {
      const ids = new Set(existing.records.map((r) => r.id));
      for (const r of recs) if (!ids.has(r.id)) existing.records.push(r);
    } else {
      groups.set(key, { key, confidence, reason, records: [...recs] });
    }
  };

  // 1. Email exact match (high)
  const byEmail = new Map<string, OwnerRecord[]>();
  for (const o of owners) {
    const e = norm(o.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e)!.push(o);
  }
  for (const [email, recs] of byEmail) {
    if (recs.length >= 2) addToGroup(`email:${email}`, "high", `Same email (${email})`, recs);
  }

  // 2. Phone digits match (medium) — only if 7+ digits to avoid noise
  const byPhone = new Map<string, OwnerRecord[]>();
  for (const o of owners) {
    const p = digits(o.phone);
    if (p.length < 7) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p)!.push(o);
  }
  for (const [phone, recs] of byPhone) {
    if (recs.length >= 2) addToGroup(`phone:${phone}`, "medium", `Same phone number`, recs);
  }

  // 3. Same last name + similar first name (low)
  const byLast = new Map<string, OwnerRecord[]>();
  for (const o of owners) {
    const l = norm(o.last_name);
    if (!l) continue;
    if (!byLast.has(l)) byLast.set(l, []);
    byLast.get(l)!.push(o);
  }
  for (const [last, recs] of byLast) {
    if (recs.length < 2) continue;
    // pairwise within last-name bucket
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i];
        const b = recs[j];
        const fa = norm(a.first_name);
        const fb = norm(b.first_name);
        if (!fa || !fb) continue;
        const dist = levenshtein(fa, fb);
        const prefix = fa.slice(0, 3) === fb.slice(0, 3) && fa.length >= 3 && fb.length >= 3;
        if (dist <= 2 || prefix) {
          addToGroup(
            `name:${last}:${pairKey(a.id, b.id)}`,
            "low",
            `Similar name (${a.first_name} & ${b.first_name} ${last})`,
            [a, b],
          );
        }
      }
    }
  }

  return filterDismissed(groups, dismissedPairs);
}

export function findPetDuplicates(
  pets: PetRecord[],
  dismissedPairs: Set<string>,
): DuplicateGroup<PetRecord>[] {
  const groups = new Map<string, DuplicateGroup<PetRecord>>();
  const addToGroup = (
    key: string,
    confidence: Confidence,
    reason: string,
    recs: PetRecord[],
  ) => {
    if (recs.length < 2) return;
    const existing = groups.get(key);
    if (existing) {
      const ids = new Set(existing.records.map((r) => r.id));
      for (const r of recs) if (!ids.has(r.id)) existing.records.push(r);
    } else {
      groups.set(key, { key, confidence, reason, records: [...recs] });
    }
  };

  // 1. Same pet name + same owner (high)
  const byNameOwner = new Map<string, PetRecord[]>();
  for (const p of pets) {
    const n = norm(p.name);
    if (!n) continue;
    for (const oid of p.owner_ids) {
      const k = `${n}::${oid}`;
      if (!byNameOwner.has(k)) byNameOwner.set(k, []);
      byNameOwner.get(k)!.push(p);
    }
  }
  for (const [k, recs] of byNameOwner) {
    if (recs.length >= 2) {
      const unique = Array.from(new Map(recs.map((r) => [r.id, r])).values());
      if (unique.length >= 2) {
        addToGroup(`name-owner:${k}`, "high", `Same name & owner`, unique);
      }
    }
  }

  // 2. Same name + same breed + similar owner name (medium)
  const byNameBreed = new Map<string, PetRecord[]>();
  for (const p of pets) {
    const n = norm(p.name);
    const b = norm(p.breed);
    if (!n || !b) continue;
    const k = `${n}::${b}`;
    if (!byNameBreed.has(k)) byNameBreed.set(k, []);
    byNameBreed.get(k)!.push(p);
  }
  for (const [k, recs] of byNameBreed) {
    if (recs.length < 2) continue;
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i];
        const b = recs[j];
        // Skip if already same-owner (covered by high)
        if (a.owner_ids.some((id) => b.owner_ids.includes(id))) continue;
        const aName = norm(a.owner_names.join(" "));
        const bName = norm(b.owner_names.join(" "));
        if (!aName || !bName) continue;
        const dist = levenshtein(aName, bName);
        if (dist <= 3) {
          addToGroup(
            `name-breed:${k}:${pairKey(a.id, b.id)}`,
            "medium",
            `Same name + breed, similar owner`,
            [a, b],
          );
        }
      }
    }
  }

  return filterDismissed(groups, dismissedPairs);
}

function filterDismissed<T extends { id: string }>(
  groups: Map<string, DuplicateGroup<T>>,
  dismissed: Set<string>,
): DuplicateGroup<T>[] {
  const out: DuplicateGroup<T>[] = [];
  for (const g of groups.values()) {
    // If every pair within the group is dismissed, drop the group.
    const ids = g.records.map((r) => r.id);
    let anyLive = false;
    outer: for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!dismissed.has(pairKey(ids[i], ids[j]))) {
          anyLive = true;
          break outer;
        }
      }
    }
    if (anyLive) out.push(g);
  }
  // Sort: high → medium → low, then larger groups first
  const order: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.confidence] - order[b.confidence] || b.records.length - a.records.length);
  return out;
}

export const dupePairKey = pairKey;
