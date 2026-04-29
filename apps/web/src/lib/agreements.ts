export const AGREEMENT_TYPES = [
  { value: "waiver", label: "Waiver" },
  { value: "liability", label: "Liability" },
  { value: "policy", label: "Policy" },
  { value: "service_agreement", label: "Service Agreement" },
] as const;

export function agreementTypeLabel(v: string): string {
  return AGREEMENT_TYPES.find((t) => t.value === v)?.label ?? v;
}

export const REQUIRED_FOR = [
  { value: "all", label: "Required for all new customers" },
  { value: "services", label: "Required for specific services" },
  { value: "optional", label: "Optional" },
] as const;

export function requiredForLabel(v: string): string {
  return REQUIRED_FOR.find((r) => r.value === v)?.label ?? v;
}

/**
 * Render an agreement template by replacing merge fields:
 *   {{owner_name}}, {{pet_name}}, {{date}}, {{business_name}}
 */
export function renderTemplate(
  body: string,
  ctx: { owner_name?: string; pet_name?: string; date?: string; business_name?: string },
): string {
  return (body ?? "")
    .split("{{owner_name}}").join(ctx.owner_name ?? "")
    .split("{{pet_name}}").join(ctx.pet_name ?? "")
    .split("{{date}}").join(ctx.date ?? new Date().toLocaleDateString())
    .split("{{business_name}}").join(ctx.business_name ?? "");
}

export const MERGE_FIELDS = [
  { token: "{{owner_name}}", label: "Owner name" },
  { token: "{{pet_name}}", label: "Pet name" },
  { token: "{{date}}", label: "Today's date" },
  { token: "{{business_name}}", label: "Business name" },
];
