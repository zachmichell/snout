import { supabase } from "@/integrations/supabase/client";
import type {
  ColumnMapping,
  DataType,
  MatchMethod,
  MatchStats,
  ParsedFile,
  RowIssue,
  ValidatedRow,
  ValidationResult,
} from "./types";
import { SNOUT_FIELDS } from "./snoutFields";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseDate(v: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDateTime(v: string): string | null {
  if (!v) return null;
  const d = new Date(v.trim());
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeSpecies(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["dog", "canine", "k9", "puppy"].includes(s)) return "dog";
  if (["cat", "feline", "kitten"].includes(s)) return "cat";
  return "other";
}

function normalizeSex(v: string): string {
  const s = v.trim().toLowerCase();
  if (s.startsWith("m")) return "M";
  if (s.startsWith("f")) return "F";
  return "U";
}

function normalizeBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "t", "1"].includes(s)) return true;
  if (["no", "n", "false", "f", "0"].includes(s)) return false;
  return null;
}

const VAX_TYPES = ["rabies", "dapp", "dhpp", "bordetella", "lepto", "lyme", "influenza", "fvrcp", "other"];
function normalizeVaccine(v: string): string {
  const s = v.trim().toLowerCase();
  for (const t of VAX_TYPES) if (s.includes(t)) return t;
  return "other";
}

function applyMapping(
  row: Record<string, string>,
  mapping: ColumnMapping,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [snoutField, csvHeader] of Object.entries(mapping)) {
    out[snoutField] = (row[csvHeader] ?? "").toString().trim();
  }
  return out;
}

// Normalize: lowercase, trim, collapse whitespace, strip non-alphanumeric (keep spaces)
function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type OwnerLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  external_id: string | null;
  external_source: string | null;
};

type OwnerMaps = {
  exact: Map<string, string>; // "first last" -> id
  lastName: Map<string, string[]>; // "last" -> [ids]
  externalId: Map<string, string>; // ext_id -> id
  email: Map<string, string>;
  owners: OwnerLite[];
  fullNames: { id: string; full: string; last: string }[]; // for suggestions
};

function buildOwnerMaps(owners: OwnerLite[]): OwnerMaps {
  const exact = new Map<string, string>();
  const lastName = new Map<string, string[]>();
  const externalId = new Map<string, string>();
  const email = new Map<string, string>();
  const fullNames: { id: string; full: string; last: string }[] = [];

  for (const o of owners) {
    const fn = normName(o.first_name ?? "");
    const ln = normName(o.last_name ?? "");
    const full = `${fn} ${ln}`.trim();
    if (full) {
      // first writer wins; if duplicate exact names exist we still resolve to one
      if (!exact.has(full)) exact.set(full, o.id);
      fullNames.push({ id: o.id, full, last: ln });
    }
    if (ln) {
      const arr = lastName.get(ln) ?? [];
      arr.push(o.id);
      lastName.set(ln, arr);
    }
    if (o.external_id) {
      externalId.set(o.external_id, o.id);
    }
    if (o.email) {
      email.set(o.email.toLowerCase(), o.id);
    }
  }
  return { exact, lastName, externalId, email, owners, fullNames };
}

type MatchResult = { ownerId: string | null; method: MatchMethod; suggestion: string | null };

function matchOwner(
  oName: string,
  oExternalId: string | null,
  oEmail: string | null,
  maps: OwnerMaps,
): MatchResult {
  // 1. Email
  if (oEmail) {
    const id = maps.email.get(oEmail.toLowerCase());
    if (id) return { ownerId: id, method: "email", suggestion: null };
  }
  // 2. External ID cross-reference
  if (oExternalId) {
    const id = maps.externalId.get(oExternalId);
    if (id) return { ownerId: id, method: "external_id", suggestion: null };
  }

  const norm = normName(oName);
  if (!norm) return { ownerId: null, method: "none", suggestion: null };

  // 3. Exact full-name
  const exactId = maps.exact.get(norm);
  if (exactId) return { ownerId: exactId, method: "exact", suggestion: null };

  // 4. Last-name uniqueness — last token of o_name
  const tokens = norm.split(" ");
  const lastTok = tokens[tokens.length - 1];
  if (lastTok) {
    const candidates = maps.lastName.get(lastTok);
    if (candidates && candidates.length === 1) {
      return { ownerId: candidates[0], method: "last_name", suggestion: null };
    }
  }

  // 5. Find suggestion (closest by shared last-name or substring)
  let suggestion: string | null = null;
  if (lastTok) {
    const candidates = maps.lastName.get(lastTok);
    if (candidates && candidates.length > 1) {
      const names = maps.fullNames
        .filter((n) => candidates.includes(n.id))
        .slice(0, 3)
        .map((n) => n.full);
      suggestion = `Multiple owners with last name "${lastTok}": ${names.join(", ")}`;
    }
  }
  if (!suggestion) {
    // substring fallback for suggestion
    const hit = maps.fullNames.find((n) => n.full.includes(norm) || norm.includes(n.full));
    if (hit) suggestion = hit.full;
  }

  return { ownerId: null, method: "none", suggestion };
}

export async function validateRows(
  parsed: ParsedFile,
  dataType: DataType,
  mapping: ColumnMapping,
  organizationId: string,
): Promise<ValidationResult> {
  const existingOwnerEmails = new Map<string, string>(); // email -> id
  const existingOwnerNames = new Map<string, string>(); // "first last" -> id
  let ownerMaps: OwnerMaps | null = null;
  const petKeyToId = new Map<string, string>();
  // For pets: map (norm name + owner_id) -> existing pet id
  const existingPetByNameOwner = new Map<string, string>();

  if (dataType === "owners" || dataType === "pets" || dataType === "vaccinations" || dataType === "reservations") {
    // Page through owners (>1000 row default limit)
    const PAGE = 1000;
    let from = 0;
    const allOwners: OwnerLite[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("owners")
        .select("id, email, first_name, last_name, external_id, external_source")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .range(from, from + PAGE - 1);
      if (error) break;
      const batch = (data ?? []) as OwnerLite[];
      allOwners.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    for (const o of allOwners) {
      if (o.email) existingOwnerEmails.set(o.email.toLowerCase(), o.id);
      const fn = normName(o.first_name ?? "");
      const ln = normName(o.last_name ?? "");
      const key = `${fn} ${ln}`.trim();
      if (key && !existingOwnerNames.has(key)) existingOwnerNames.set(key, o.id);
    }
    ownerMaps = buildOwnerMaps(allOwners);
  }

  if (dataType === "vaccinations" || dataType === "reservations" || dataType === "pets") {
    const { data: pets } = await supabase
      .from("pets")
      .select("id, name, pet_owners(owner_id, owners(email))")
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    for (const p of pets ?? []) {
      const links = (p.pet_owners as any[]) ?? [];
      const nameNorm = normName(p.name ?? "");
      for (const link of links) {
        const email = link.owners?.email?.toLowerCase();
        if (email) petKeyToId.set(`${email}::${(p.name ?? "").toLowerCase()}`, p.id);
        if (link.owner_id && nameNorm) {
          const k = `${nameNorm}::${link.owner_id}`;
          if (!existingPetByNameOwner.has(k)) existingPetByNameOwner.set(k, p.id);
        }
      }
    }
  }

  const fields = SNOUT_FIELDS[dataType];
  const required = fields.filter((f) => f.required).map((f) => f.key);

  const stats: MatchStats = { exact: 0, external_id: 0, last_name: 0, email: 0, unlinked: 0 };

  // In-batch dedupe state (across rows of THIS file)
  const seenEmails = new Map<string, number>(); // email -> first row index
  const seenNames = new Map<string, number>();
  const seenPetKeys = new Map<string, number>();

  const rows = parsed.rows.map((raw, index) => {
    const m = applyMapping(raw, mapping);
    const issues: RowIssue[] = [];
    const mapped: Record<string, any> = {};
    let matchMethod: MatchMethod | undefined;
    let matchSuggestion: string | null | undefined;

    for (const r of required) {
      if (!m[r] || m[r] === "") {
        issues.push({ severity: "error", field: r, message: `Missing required field` });
      }
    }

    // Email format: warning for owners (don't block), error elsewhere
    if (m.email && !EMAIL_RE.test(m.email)) {
      issues.push({
        severity: dataType === "owners" ? "warning" : "error",
        field: "email",
        message: "Invalid email format — will be skipped",
      });
    }
    if (m.owner_email && !EMAIL_RE.test(m.owner_email)) {
      issues.push({ severity: "warning", field: "owner_email", message: "Invalid email format" });
    }

    if (dataType === "owners") {
      mapped.external_id = m.external_id || null;
      mapped.first_name = m.first_name || null;
      mapped.last_name = m.last_name || null;
      const emailValid = m.email && EMAIL_RE.test(m.email);
      mapped.email = emailValid ? m.email.toLowerCase() : null;
      mapped.phone = m.phone || null;
      mapped.home_phone = m.home_phone || null;
      mapped.street_address = m.street_address || null;
      mapped.city = m.city || null;
      mapped.state_province = m.state_province || null;
      mapped.postal_code = m.postal_code || null;
      const noteParts: string[] = [];
      if (m.notes) noteParts.push(m.notes);
      if (m.referral_source) noteParts.push(`Referral: ${m.referral_source}`);
      if (m.home_phone && !mapped.phone) noteParts.push(`Home phone: ${m.home_phone}`);
      mapped.notes = noteParts.length ? noteParts.join("\n") : null;

      // Duplicate detection: by email if present, otherwise by exact name
      let dupId: string | null = null;
      if (mapped.email) {
        const exId = existingOwnerEmails.get(mapped.email);
        if (exId) dupId = exId;
        else if (seenEmails.has(mapped.email)) dupId = "__inbatch__";
        if (dupId) {
          issues.push({
            severity: "warning",
            field: "email",
            message: "Duplicate — owner with this email already exists",
          });
        }
        seenEmails.set(mapped.email, index);
      } else {
        const fnNorm = normName(mapped.first_name ?? "");
        const lnNorm = normName(mapped.last_name ?? "");
        const nameKey = `${fnNorm} ${lnNorm}`.trim();
        if (nameKey) {
          const exId = existingOwnerNames.get(nameKey);
          if (exId) dupId = exId;
          else if (seenNames.has(nameKey)) dupId = "__inbatch__";
          if (dupId) {
            issues.push({
              severity: "warning",
              field: "last_name",
              message: "Duplicate — owner with this name already exists (no email to disambiguate)",
            });
          }
          seenNames.set(nameKey, index);
        }
      }
      if (dupId) {
        mapped._duplicate_of = dupId === "__inbatch__" ? null : dupId;
      }
    }

    if (dataType === "pets") {
      mapped.external_id = m.external_id || null;
      mapped.name = m.name;
      mapped.species = normalizeSpecies(m.species || "");
      if (!mapped.species) {
        issues.push({ severity: "error", field: "species", message: "Could not determine species" });
      }
      mapped.breed = m.breed || null;
      mapped.sex = normalizeSex(m.sex || "");
      const fixed = normalizeBool(m.is_fixed || "");
      if (fixed !== null) mapped.spayed_neutered = fixed;
      if (m.date_of_birth) {
        const d = parseDate(m.date_of_birth);
        if (!d) issues.push({ severity: "warning", field: "date_of_birth", message: "Invalid date" });
        mapped.date_of_birth = d;
      }
      if (m.weight_lbs) {
        const lbs = parseFloat(m.weight_lbs);
        if (isNaN(lbs)) {
          issues.push({ severity: "warning", field: "weight_lbs", message: "Invalid weight" });
        } else {
          mapped.weight_kg = +(lbs * 0.453592).toFixed(2);
        }
      }
      mapped.color = m.color || null;
      mapped.microchip_id = m.microchip_id || null;
      if (m.veterinarian) {
        mapped.behavioral_notes = `Veterinarian: ${m.veterinarian}`;
      }

      // Owner linking — multi-tier, fast lookups
      if (ownerMaps) {
        const result = matchOwner(
          m.owner_name || "",
          m.owner_external_id || null,
          m.owner_email || null,
          ownerMaps,
        );
        matchMethod = result.method;
        matchSuggestion = result.suggestion;
        if (result.ownerId) {
          mapped._owner_id = result.ownerId;
          stats[result.method]++;
        } else {
          stats.unlinked++;
          if (m.owner_name || m.owner_email) {
            const tried = m.owner_name || m.owner_email;
            const sug = result.suggestion ? ` — closest: ${result.suggestion}` : "";
            issues.push({
              severity: "warning",
              field: "owner_name",
              message: `Owner not found ("${tried}")${sug} — pet will be imported unlinked`,
            });
          }
        }
      }

      // Pet duplicate detection: same normalized name + same matched owner
      if (mapped._owner_id && mapped.name) {
        const k = `${normName(mapped.name)}::${mapped._owner_id}`;
        const exId = existingPetByNameOwner.get(k);
        if (exId) {
          mapped._duplicate_of = exId;
          issues.push({
            severity: "warning",
            field: "name",
            message: "Duplicate — pet with this name already exists for this owner",
          });
        } else if (seenPetKeys.has(k)) {
          mapped._duplicate_of = null;
          issues.push({
            severity: "warning",
            field: "name",
            message: "Duplicate — same name + owner appears earlier in this file",
          });
        }
        seenPetKeys.set(k, index);
      }
    }

    if (dataType === "vaccinations") {
      mapped.pet_name = m.pet_name;
      mapped.owner_email = m.owner_email?.toLowerCase();
      mapped.vaccine_type = normalizeVaccine(m.vaccine_name || "");
      mapped.administered_on = m.administered_date ? parseDate(m.administered_date) : null;
      mapped.expires_on = m.expiry_date ? parseDate(m.expiry_date) : null;
      mapped.vet_name = m.vet_name || null;
      mapped.vet_clinic = m.vet_clinic || null;
      const key = `${mapped.owner_email}::${mapped.pet_name?.toLowerCase()}`;
      const petId = petKeyToId.get(key);
      if (!petId) {
        issues.push({
          severity: "error",
          field: "pet_name",
          message: "Pet not found — import pets first",
        });
      } else {
        mapped._pet_id = petId;
      }
    }

    if (dataType === "reservations") {
      mapped.owner_email = m.owner_email?.toLowerCase();
      mapped.pet_name = m.pet_name;
      mapped.service_name = m.service_name || null;
      mapped.start_at = m.start_at ? parseDateTime(m.start_at) : null;
      mapped.end_at = m.end_at ? parseDateTime(m.end_at) : null;
      mapped.notes = m.notes || null;
      if (m.start_at && !mapped.start_at) {
        issues.push({ severity: "error", field: "start_at", message: "Invalid start date" });
      }
      if (m.end_at && !mapped.end_at) {
        issues.push({ severity: "error", field: "end_at", message: "Invalid end date" });
      }
      const ownerId = ownerMaps?.email.get(mapped.owner_email);
      if (!ownerId) {
        issues.push({ severity: "error", field: "owner_email", message: "Owner not found" });
      } else {
        mapped._owner_id = ownerId;
      }
      const key = `${mapped.owner_email}::${mapped.pet_name?.toLowerCase()}`;
      const petId = petKeyToId.get(key);
      if (!petId) {
        issues.push({ severity: "error", field: "pet_name", message: "Pet not found" });
      } else {
        mapped._pet_id = petId;
      }
    }

    const isDup = mapped._duplicate_of !== undefined;
    return {
      index,
      raw,
      mapped,
      issues,
      include: !issues.some((i) => i.severity === "error"),
      isDuplicate: isDup,
      duplicateOfId: isDup ? (mapped._duplicate_of as string | null) : undefined,
      matchMethod,
      matchSuggestion,
    } as ValidatedRow;
  });

  return { rows, matchStats: dataType === "pets" ? stats : undefined };
}
