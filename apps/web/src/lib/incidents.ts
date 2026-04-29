// Helpers and constants for incidents.

import {
  AlertTriangle,
  Activity,
  Bandage,
  DoorOpen,
  Hammer,
  HeartPulse,
  Bone,
  Swords,
  type LucideIcon,
} from "lucide-react";

export type IncidentType =
  | "bite"
  | "fight"
  | "injury"
  | "escape_attempt"
  | "property_damage"
  | "behavioral"
  | "medical_emergency"
  | "other";

export type IncidentSeverity = "minor" | "moderate" | "serious" | "critical";

export type IncidentRole = "involved" | "instigator" | "victim" | "witness";

export const INCIDENT_TYPES: { value: IncidentType; staff: string; owner: string; icon: LucideIcon }[] = [
  { value: "bite", staff: "Bite", owner: "Bite Incident", icon: Bone },
  { value: "fight", staff: "Fight", owner: "Altercation", icon: Swords },
  { value: "injury", staff: "Injury", owner: "Injury", icon: Bandage },
  { value: "escape_attempt", staff: "Escape Attempt", owner: "Escape Attempt", icon: DoorOpen },
  { value: "property_damage", staff: "Property Damage", owner: "Property Damage", icon: Hammer },
  { value: "behavioral", staff: "Behavioral", owner: "Behavioral Note", icon: Activity },
  { value: "medical_emergency", staff: "Medical Emergency", owner: "Medical Event", icon: HeartPulse },
  { value: "other", staff: "Other", owner: "Other", icon: AlertTriangle },
];

export function incidentTypeMeta(t: IncidentType) {
  return INCIDENT_TYPES.find((x) => x.value === t) ?? INCIDENT_TYPES[INCIDENT_TYPES.length - 1];
}

export function incidentTypeStaffLabel(t: IncidentType): string {
  return incidentTypeMeta(t).staff;
}

export function incidentTypeOwnerLabel(t: IncidentType): string {
  return incidentTypeMeta(t).owner;
}

export const INCIDENT_SEVERITIES: { value: IncidentSeverity; label: string }[] = [
  { value: "minor", label: "Minor" },
  { value: "moderate", label: "Moderate" },
  { value: "serious", label: "Serious" },
  { value: "critical", label: "Critical" },
];

// Severity badge tones using semantic tokens / brand palette.
export const SEVERITY_BADGE: Record<IncidentSeverity, string> = {
  minor: "bg-teal-light text-teal border-teal/20",
  moderate: "bg-warning-light text-warning border-warning/20",
  serious: "bg-brand-cotton-bg text-destructive border-destructive/20",
  critical: "bg-destructive-light text-destructive border-destructive/30",
};

// Subtler accent for owner portal (no alarming labels).
export const SEVERITY_OWNER_ACCENT: Record<IncidentSeverity, string> = {
  minor: "border-l-teal",
  moderate: "border-l-warning",
  serious: "border-l-brand-cotton",
  critical: "border-l-destructive",
};

export const INCIDENT_ROLES: { value: IncidentRole; label: string; tone: string }[] = [
  { value: "involved", label: "Involved", tone: "bg-muted text-muted-foreground border-border" },
  { value: "instigator", label: "Instigator", tone: "bg-destructive-light text-destructive border-destructive/20" },
  { value: "victim", label: "Victim", tone: "bg-warning-light text-warning border-warning/20" },
  { value: "witness", label: "Witness", tone: "bg-teal-light text-teal border-teal/20" },
];

export function roleMeta(r: IncidentRole) {
  return INCIDENT_ROLES.find((x) => x.value === r) ?? INCIDENT_ROLES[0];
}
