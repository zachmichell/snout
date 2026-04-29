// Helpers for care logs and report cards.

export type LogType = "feeding" | "medication" | "potty" | "play" | "rest" | "note";

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  feeding: "Feeding",
  medication: "Medication",
  potty: "Potty",
  play: "Play",
  rest: "Rest",
  note: "Note",
};

// Tailwind classes for the brand-colored log type chips & timeline dots
export const LOG_TYPE_CHIP: Record<LogType, string> = {
  feeding: "bg-brand-vanilla text-foreground",
  medication: "bg-brand-cotton text-foreground",
  potty: "bg-brand-frost text-foreground",
  play: "bg-brand-mist text-foreground",
  rest: "bg-brand-blueberry text-foreground",
  note: "bg-primary text-primary-foreground",
};

export const LOG_TYPE_DOT: Record<LogType, string> = {
  feeding: "bg-brand-vanilla",
  medication: "bg-brand-cotton",
  potty: "bg-brand-frost",
  play: "bg-brand-mist",
  rest: "bg-brand-blueberry",
  note: "bg-primary",
};

// Owner-friendly icons (emoji) for the care log timeline
export const LOG_TYPE_EMOJI: Record<LogType, string> = {
  feeding: "🥣",
  medication: "💊",
  potty: "🚽",
  play: "🎾",
  rest: "💤",
  note: "📝",
};

export type Rating = "excellent" | "good" | "fair" | "needs_attention";
export type Mood = "happy" | "playful" | "calm" | "anxious" | "tired";
export type Energy = "high" | "medium" | "low";
export type Appetite = "ate_all" | "ate_some" | "ate_little" | "refused";
export type Sociability = "very_social" | "social" | "selective" | "kept_to_self";

export const RATING_OPTIONS: { value: Rating; label: string; emoji: string; tone: string }[] = [
  { value: "excellent", label: "Excellent", emoji: "🌟", tone: "bg-[#C7D0C5] text-[#2f4530]" },
  { value: "good", label: "Good", emoji: "😊", tone: "bg-[#EED4BB] text-[#4a3520]" },
  { value: "fair", label: "Fair", emoji: "🙂", tone: "bg-[#F2D3C9] text-[#5a2a22]" },
  { value: "needs_attention", label: "Needs Attention", emoji: "⚠️", tone: "bg-destructive/10 text-destructive" },
];

export const MOOD_OPTIONS: { value: Mood; label: string; emoji: string }[] = [
  { value: "happy", label: "Happy", emoji: "😄" },
  { value: "playful", label: "Playful", emoji: "🐶" },
  { value: "calm", label: "Calm", emoji: "😌" },
  { value: "anxious", label: "Anxious", emoji: "😟" },
  { value: "tired", label: "Tired", emoji: "😴" },
];

export const ENERGY_OPTIONS: { value: Energy; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const APPETITE_OPTIONS: { value: Appetite; label: string }[] = [
  { value: "ate_all", label: "Ate all" },
  { value: "ate_some", label: "Ate some" },
  { value: "ate_little", label: "Ate little" },
  { value: "refused", label: "Refused" },
];

export const SOCIABILITY_OPTIONS: { value: Sociability; label: string }[] = [
  { value: "very_social", label: "Very Social" },
  { value: "social", label: "Social" },
  { value: "selective", label: "Selective" },
  { value: "kept_to_self", label: "Kept to Self" },
];

// Build a deterministic template summary from the day's logs for a single pet.
export function buildSummary(petName: string, logs: { log_type: LogType; notes?: string | null }[]): string {
  if (!logs.length) return `${petName} had a quiet visit today.`;

  const counts: Record<LogType, number> = {
    feeding: 0, medication: 0, potty: 0, play: 0, rest: 0, note: 0,
  };
  for (const l of logs) counts[l.log_type]++;

  const parts: string[] = [];
  if (counts.feeding > 0) parts.push(`was fed ${counts.feeding} time${counts.feeding === 1 ? "" : "s"}`);
  if (counts.play > 0) parts.push(`enjoyed ${counts.play} play session${counts.play === 1 ? "" : "s"}`);
  if (counts.rest > 0) parts.push(`took ${counts.rest} rest break${counts.rest === 1 ? "" : "s"}`);
  if (counts.potty > 0) parts.push(`had ${counts.potty} potty break${counts.potty === 1 ? "" : "s"}`);
  if (counts.medication > 0) parts.push(`received medication ${counts.medication} time${counts.medication === 1 ? "" : "s"}`);

  if (!parts.length) return `${petName} had a calm visit today.`;
  if (parts.length === 1) return `${petName} ${parts[0]}.`;
  const last = parts.pop();
  return `${petName} ${parts.join(", ")}, and ${last}.`;
}

// Best-guess appetite from feeding-log notes
export function inferAppetite(feedingLogs: { notes?: string | null }[]): Appetite | undefined {
  if (!feedingLogs.length) return undefined;
  const text = feedingLogs.map((l) => (l.notes ?? "").toLowerCase()).join(" ");
  if (/refus|wouldn't eat|did not eat|didn't eat/.test(text)) return "refused";
  if (/little|barely|nibble/.test(text)) return "ate_little";
  if (/some|half|partial/.test(text)) return "ate_some";
  if (/all|finished|enthus|cleaned|every bite/.test(text)) return "ate_all";
  return "ate_some";
}

export function ratingMeta(r?: string | null) {
  return RATING_OPTIONS.find((o) => o.value === r) ?? null;
}

export function moodMeta(m?: string | null) {
  return MOOD_OPTIONS.find((o) => o.value === m) ?? null;
}

export function formatTime(value: string | Date | null | undefined, tz?: string) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
}
