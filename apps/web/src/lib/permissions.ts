export type Role = "owner" | "admin" | "manager" | "staff" | "customer";

export type Permission =
  | "settings.view"
  | "settings.organization"
  | "settings.locations"
  | "settings.team"
  | "settings.payments"
  | "settings.billing"
  | "settings.email"
  | "settings.subscription"
  | "analytics.view"
  | "revenue.view"
  | "reservations.create"
  | "reservations.edit"
  | "reservations.cancel"
  | "checkinout.perform"
  | "carelogs.create"
  | "reportcards.create"
  | "reportcards.publish"
  | "incidents.create"
  | "incidents.edit"
  | "messaging.send"
  | "invoices.view"
  | "invoices.create"
  | "invoices.edit"
  | "invoices.send"
  | "pets.create"
  | "pets.edit"
  | "owners.create"
  | "owners.edit"
  | "services.manage"
  | "playgroups.manage"
  | "kennels.manage"
  | "data.import"
  | "data.export"
  | "data.merge"
  | "audit.view";

const ALL: Permission[] = [
  "settings.view",
  "settings.organization",
  "settings.locations",
  "settings.team",
  "settings.payments",
  "settings.billing",
  "settings.email",
  "settings.subscription",
  "analytics.view",
  "revenue.view",
  "reservations.create",
  "reservations.edit",
  "reservations.cancel",
  "checkinout.perform",
  "carelogs.create",
  "reportcards.create",
  "reportcards.publish",
  "incidents.create",
  "incidents.edit",
  "messaging.send",
  "invoices.view",
  "invoices.create",
  "invoices.edit",
  "invoices.send",
  "pets.create",
  "pets.edit",
  "owners.create",
  "owners.edit",
  "services.manage",
  "playgroups.manage",
  "kennels.manage",
  "data.import",
  "data.export",
  "data.merge",
  "audit.view",
];

const ADMIN: Permission[] = ALL.filter(
  (p) => p !== "settings.billing" && p !== "settings.subscription" && p !== "settings.payments"
);

const MANAGER: Permission[] = [
  "settings.view",
  "settings.locations",
  "analytics.view",
  "revenue.view",
  "reservations.create",
  "reservations.edit",
  "reservations.cancel",
  "checkinout.perform",
  "carelogs.create",
  "reportcards.create",
  "reportcards.publish",
  "incidents.create",
  "incidents.edit",
  "messaging.send",
  "invoices.view",
  "invoices.create",
  "invoices.edit",
  "invoices.send",
  "pets.create",
  "pets.edit",
  "owners.create",
  "owners.edit",
  "playgroups.manage",
  "kennels.manage",
  "data.export",
  "audit.view",
];

const STAFF: Permission[] = [
  "checkinout.perform",
  "carelogs.create",
  "reportcards.create",
  "incidents.create",
  "messaging.send",
  "invoices.view",
];

const CUSTOMER: Permission[] = [];

export const PERMISSIONS_BY_ROLE: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ADMIN,
  manager: MANAGER,
  staff: STAFF,
  customer: CUSTOMER,
};

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false;
}
