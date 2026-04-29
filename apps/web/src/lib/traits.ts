// Helpers and constants for pet_traits.

export type TraitCategory = "temperament" | "play_style" | "social" | "triggers" | "handling" | "other";
export type TraitSeverity = "info" | "caution" | "warning";

export const TRAIT_CATEGORIES: { value: TraitCategory; label: string; description: string }[] = [
  { value: "temperament", label: "Temperament", description: "Personality traits" },
  { value: "play_style", label: "Play Style", description: "How they play" },
  { value: "social", label: "Social", description: "With other animals & people" },
  { value: "triggers", label: "Triggers", description: "Known triggers" },
  { value: "handling", label: "Handling", description: "Handling notes" },
  { value: "other", label: "Other", description: "Anything else" },
];

export const TRAIT_CATEGORY_ORDER: TraitCategory[] = [
  "temperament",
  "play_style",
  "social",
  "triggers",
  "handling",
  "other",
];

export function categoryLabel(c: TraitCategory): string {
  return TRAIT_CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

// Hardcoded quick-add suggestions per category.
export const TRAIT_SUGGESTIONS: Record<TraitCategory, string[]> = {
  temperament: ["Shy", "Confident", "Anxious in new environments", "Friendly", "Independent", "Easily startled"],
  play_style: ["Rough player", "Prefers fetch", "Loves tug", "Doesn't play with toys", "Solo player", "Loves water play"],
  social: [
    "Good with small dogs",
    "Good with large dogs",
    "Reactive to large dogs",
    "Reactive to small dogs",
    "Prefers female handlers",
    "Prefers male handlers",
    "Doesn't like being picked up",
  ],
  triggers: [
    "Thunder/fireworks",
    "Resource guards food",
    "Resource guards toys",
    "Leash reactive",
    "Stranger danger",
    "Doesn't like beards/hats",
  ],
  handling: [
    "Muzzle for nail trims",
    "Lifts into tub — bad hips",
    "Slip lead only",
    "Harness only — escapes collars",
    "Two-person hold for grooming",
  ],
  other: [],
};

// Severity → semantic-token classes (chip + dot)
export const SEVERITY_CHIP: Record<TraitSeverity, string> = {
  info: "bg-success-light text-success border-success/20",
  caution: "bg-warning-light text-warning border-warning/20",
  warning: "bg-destructive-light text-destructive border-destructive/20",
};

export const SEVERITY_DOT: Record<TraitSeverity, string> = {
  info: "bg-success",
  caution: "bg-warning",
  warning: "bg-destructive",
};

export const SEVERITY_OPTIONS: { value: TraitSeverity; label: string; help: string }[] = [
  { value: "info", label: "Info", help: "Neutral observation" },
  { value: "caution", label: "Caution", help: "Staff should be aware" },
  { value: "warning", label: "Warning", help: "Requires active management" },
];
