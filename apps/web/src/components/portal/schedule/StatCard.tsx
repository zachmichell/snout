type Variant = "cotton" | "vanilla" | "frost" | "mist";

const map: Record<Variant, { bar: string; bg: string }> = {
  cotton: { bar: "bg-brand-cotton", bg: "bg-brand-cotton-bg" },
  vanilla: { bar: "bg-brand-vanilla", bg: "bg-brand-vanilla-bg" },
  frost: { bar: "bg-brand-frost", bg: "bg-brand-frost-bg" },
  mist: { bar: "bg-brand-mist", bg: "bg-brand-mist-bg" },
};

export default function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | string;
  variant: Variant;
}) {
  const v = map[variant];
  return (
    <div className={`relative overflow-hidden rounded-lg border border-border ${v.bg} p-5 shadow-card`}>
      <span className={`absolute left-0 top-0 h-full w-1 ${v.bar}`} />
      <div className="label-eyebrow">{label}</div>
      <div className="mt-2 font-display text-3xl font-bold text-foreground">{value}</div>
    </div>
  );
}
