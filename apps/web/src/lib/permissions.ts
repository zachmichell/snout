export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "supervisor"
  | "staff"
  | "groomer"
  | "customer";

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
  // Nav/page view gates — used to tier the sidebar + route access.
  | "dashboard.view"
  | "calendar.view"
  | "groupclasses.view"
  | "lodging.view"
  | "grooming.view"
  | "petcare.view"
  | "pos.use"
  | "deposits.view"
  | "agreements.view"
  | "products.view"
  | "packages.view"
  | "pets.view"
  | "owners.view"
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
  "dashboard.view",
  "calendar.view",
  "groupclasses.view",
  "lodging.view",
  "grooming.view",
  "petcare.view",
  "pos.use",
  "deposits.view",
  "agreements.view",
  "products.view",
  "packages.view",
  "pets.view",
  "owners.view",
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

const uniq = (xs: Permission[]): Permission[] => Array.from(new Set(xs));

// Groomer is a specialized, narrowly-scoped role: it only ever sees the
// Grooming area, plus Messages so they can coordinate with the rest of the
// team and owners.
const GROOMER: Permission[] = ["grooming.view", "messaging.send"];

// Front-line staff: day-to-day floor operations. No billing management,
// analytics, settings, lodging assignment, or grooming.
const STAFF: Permission[] = [
  "dashboard.view",
  "calendar.view",
  "checkinout.perform",
  "reservations.create",
  "groupclasses.view",
  "petcare.view",
  "carelogs.create",
  "reportcards.create",
  "incidents.create",
  "messaging.send",
  "pets.view",
  "owners.view",
  "invoices.view",
];

// Shift lead: everything staff can do, plus editing/cancelling
// reservations, publishing report cards, editing incidents, running the
// POS, and viewing the operational + light-billing surfaces (lodging,
// grooming, deposits, agreements, products, packages). Still no analytics
// or settings.
const SUPERVISOR: Permission[] = uniq([
  ...STAFF,
  "reservations.edit",
  "reservations.cancel",
  "reportcards.publish",
  "incidents.edit",
  "lodging.view",
  "grooming.view",
  "pos.use",
  "deposits.view",
  "agreements.view",
  "products.view",
  "packages.view",
  "pets.edit",
  "owners.edit",
]);

// Manager: supervisor surface plus analytics/revenue, full invoicing,
// records creation, playgroup/kennel management, data export, audit log,
// and location settings.
const MANAGER: Permission[] = uniq([
  ...SUPERVISOR,
  "settings.view",
  "settings.locations",
  "analytics.view",
  "revenue.view",
  "invoices.create",
  "invoices.edit",
  "invoices.send",
  "pets.create",
  "owners.create",
  "playgroups.manage",
  "kennels.manage",
  "data.export",
  "audit.view",
]);

// Admin: everything except the most sensitive financial/account settings,
// which stay with the owner.
const ADMIN: Permission[] = ALL.filter(
  (p) => p !== "settings.billing" && p !== "settings.subscription" && p !== "settings.payments"
);

const CUSTOMER: Permission[] = [];

export const PERMISSIONS_BY_ROLE: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ADMIN,
  manager: MANAGER,
  supervisor: SUPERVISOR,
  staff: STAFF,
  groomer: GROOMER,
  customer: CUSTOMER,
};

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false;
}

/**
 * The landing route a given role should be sent to after login, and the
 * "go home" target shown on not-authorized / access-restricted screens.
 * Customers live in the owner portal; groomers are scoped to Grooming;
 * everyone else gets the staff Pack View dashboard.
 */
export function defaultLandingForRole(role: Role | null | undefined): string {
  switch (role) {
    case "customer":
      return "/portal/dashboard";
    case "groomer":
      return "/grooming";
    default:
      return "/dashboard";
  }
}
