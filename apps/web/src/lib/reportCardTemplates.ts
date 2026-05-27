// Shared types + helpers for report-card templates (custom fields/sections).
//
// A *template* defines a blank structure (sections → fields). When staff
// author a card from a template, we snapshot the FILLED structure onto
// report_cards.custom_sections, so owners / iOS render directly from the card
// without joining to the template and published cards survive later edits.

export type RCFieldType = "text" | "textarea" | "select" | "rating" | "boolean";

export const RC_FIELD_TYPES: { value: RCFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Paragraph" },
  { value: "select", label: "Dropdown" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "boolean", label: "Yes / No" },
];

/** A field definition within a template section. */
export interface RCField {
  id: string;
  label: string;
  type: RCFieldType;
  options?: string[]; // only for `select`
}

/** A section definition within a template. */
export interface RCSection {
  id: string;
  title: string;
  fields: RCField[];
}

/** A field with its captured value, as stored on report_cards.custom_sections. */
export interface RCFilledField {
  label: string;
  type: RCFieldType;
  value: string | number | boolean | null;
  options?: string[];
}

/** A section with captured values, as stored on report_cards.custom_sections. */
export interface RCFilledSection {
  title: string;
  fields: RCFilledField[];
}

let _id = 0;
/** Stable-enough local id for new sections/fields in the builder UI. */
export function newLocalId(prefix = "f"): string {
  _id += 1;
  return `${prefix}_${Date.now().toString(36)}_${_id}`;
}

/** Coerce an unknown jsonb value into a typed template-section array. */
export function parseSections(raw: unknown): RCSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object")
    .map((s: any) => ({
      id: String(s.id ?? newLocalId("s")),
      title: String(s.title ?? ""),
      fields: Array.isArray(s.fields)
        ? s.fields
            .filter((f: any) => f && typeof f === "object")
            .map((f: any) => ({
              id: String(f.id ?? newLocalId("f")),
              label: String(f.label ?? ""),
              type: (["text", "textarea", "select", "rating", "boolean"].includes(f.type)
                ? f.type
                : "text") as RCFieldType,
              options: Array.isArray(f.options) ? f.options.map(String) : undefined,
            }))
        : [],
    }));
}

/** Coerce an unknown jsonb value into typed filled sections (for rendering). */
export function parseFilledSections(raw: unknown): RCFilledSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object")
    .map((s: any) => ({
      title: String(s.title ?? ""),
      fields: Array.isArray(s.fields)
        ? s.fields
            .filter((f: any) => f && typeof f === "object")
            .map((f: any) => ({
              label: String(f.label ?? ""),
              type: (["text", "textarea", "select", "rating", "boolean"].includes(f.type)
                ? f.type
                : "text") as RCFieldType,
              value: f.value ?? null,
              options: Array.isArray(f.options) ? f.options.map(String) : undefined,
            }))
        : [],
    }));
}

/** Build empty filled sections from a template's definition. */
export function blankFilledSections(sections: RCSection[]): RCFilledSection[] {
  return sections.map((s) => ({
    title: s.title,
    fields: s.fields.map((f) => ({
      label: f.label,
      type: f.type,
      value: f.type === "boolean" ? false : f.type === "rating" ? 0 : "",
      options: f.options,
    })),
  }));
}

/** Human-readable rendering of a filled field value. */
export function formatFieldValue(field: RCFilledField): string {
  switch (field.type) {
    case "boolean":
      return field.value === true ? "Yes" : field.value === false ? "No" : "—";
    case "rating": {
      const n = typeof field.value === "number" ? field.value : Number(field.value) || 0;
      return n > 0 ? "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) : "—";
    }
    default: {
      const s = field.value == null ? "" : String(field.value);
      return s.trim() === "" ? "—" : s;
    }
  }
}
