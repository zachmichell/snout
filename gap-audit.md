# Snout Competitive Hardening: Gap Audit

This document maps the Gingr complaint clusters and feature requests in the
brief to the current state of the Snout codebase. Status values are
`covered`, `partial`, `missing`, `unknown`, or `not applicable`. For every
`partial`, `missing`, or `unknown` item, a one paragraph proposal follows.

The audit was originally performed in late April 2026. This file was
**refreshed on 2026-05-08** after several execution batches landed (see
"Refresh delta" below). Where the original audit said an item was missing
and it's since shipped, the item is now marked `covered` with a pointer to
the actual implementation.

## Refresh delta — what shipped since the original audit

The reliability batch (oversell guards, location_hours-driven booking
defaults, customer-upload audit-log surface), the QBO integration cluster
(invoices, payments, refunds, payouts, tips, deferred revenue), the
operator-UX batch (preferred kennel run on pets), the test batch (Vitest
unit + integration tests for credits, reports, surcharge, suite capacity,
message templates), the surcharge feature, the Helcim processor, the
in-product changelog, the SupportWidget shell, the webcam viewer, the push
notification fan-out, the iOS app build, and the message-templates
subsystem are all live. The status table in each cluster below has been
re-tabulated against this new floor.

## Top-line read

Snout's structural foundations remain stronger than the brief presumed.
Service data model is multi-service first-class via `module_enum`. Activity
logging, multi-tenant org isolation, multi-location, audit log UI, CSV
migration wizard with mappers for Gingr / PetExec / DaySmart, in-product
conversations, analytics with a true occupancy tab, and Stripe Connect
BYO are all present.

The exposed weaknesses have narrowed substantially. Test coverage is no
longer effectively absent — Vitest unit + integration suites cover the
credit ledger, financial reports, surcharge calculator, suite capacity,
and message templates. The native iOS app is real (704 Swift files) and
push notifications are wired end-to-end. Helcim has joined Stripe as a
second supported processor. Customizable per-event message templates are
in place. Drop-off / pick-up time defaults derive from `location_hours`.

What's still missing concentrates in three clusters: SMS infrastructure
(no `send-sms` function, no `sms_log` table); config-rollout safety (no
`config_snapshots` table or "undo last change" affordance); and the long
tail of importer / export / multi-location-pricing / Zapier / AI-phone /
self-wash / printable-form items called out in the secondary list.

The recommended ordering at the end of this document weighs frequency,
revenue impact, and remaining effort against the new floor.

## Cluster 1: Reliability and billing accuracy

The single largest sentiment driver in the Gingr corpus is operators
losing money to silent bugs. The defensive posture is automated tests on
the financial paths and observable audit trails on every customer-facing
upload, send, and credit movement. Test coverage is now real (six suites
under `apps/web/src/lib/__tests__/`); SMS is still missing; config
snapshots are still missing; oversell prevention is now real.

Snout's email send pipeline writes to `email_log` on every send with
status, message id, recipient, error message, and email type. SMS has no
equivalent yet. Vaccination and signature uploads write to `activity_log`
through `lib/activity.ts`, and the staff dashboard surfaces the last
seven days via `RecentCustomerUploads.tsx`.

The just-shipped `activity_log` work covers reservation lifecycle changes
and actor attribution. Package credits live in two parallel systems that
do not synchronize: the flat counters on `owners` (covered by
`src/lib/credits.ts` with atomic deduction, concurrency guard, and a
half-to-full conversion rule) and the `subscription_packages` plus
`owner_subscriptions.remaining_credits` ledger. Both now have unit and
integration test coverage.

Configuration rollout safety remains unaddressed. Snout has no
`config_snapshots` table or "Undo last change" affordance. The brief's
recommendation here is unchanged.

| Item | Status | Location |
|---|---|---|
| Customer uploads write to operator-visible audit log | covered | All four owner-portal upload paths (`PetPhotoUpload.tsx`, `VaccinationFormDialog.tsx`, `Agreements.tsx`, `WaiverDetail.tsx`) call `logActivity`. Staff dashboard reads via `components/portal/RecentCustomerUploads.tsx` (server-side `actor_kind='owner'` filter + supporting partial index). |
| Email delivery log with provider response | covered | `supabase/functions/send-email/index.ts`, table `email_log` |
| SMS delivery log with provider response | missing | No SMS sending exists; no `send-sms` function, no `sms_log` table |
| Package credit logic covered by automated tests | covered | `apps/web/src/lib/__tests__/credits.test.ts` + `credits.integration.test.ts` |
| Edge cases: refunded reservations, partial redemptions, transferred credits, expired packages, concurrent redemption | partial | `credits.test.ts` + `credits.integration.test.ts` cover deduction + concurrency; transfer / cross-owner cases not yet asserted |
| Financial reports tie out to underlying transactions | covered | `apps/web/src/lib/__tests__/reports.integration.test.ts` exercises seed → reconcile |
| Config rollouts cannot revert per-facility settings | missing | no config snapshot mechanism |
| Room or suite assignment cannot oversell | covered | `enforce_kennel_run_capacity()` and `enforce_suite_capacity()` triggers in `supabase/migrations/20260507090000_oversell_guards.sql` |
| Feeding reports stable across room group switches | unknown | Inspection of `Feeding` UI deferred |

### Proposed approaches for partial and missing items

For SMS, add an `sms_log` table mirroring `email_log`, ship a
`supabase/functions/send-sms/index.ts` against Twilio with Canadian A2P
10DLC long-code routing, and back the `communication_pref` with actual
sends. Reservation reminders and waiver reminders are the obvious first
send paths. Provider response codes from Twilio go into `metadata` jsonb.

For credit edge-case test coverage, extend `credits.integration.test.ts`
with: refunded reservation re-credits (insert reservation, redeem credits,
cancel reservation with `refund_credits = true`, assert balance restored);
expired `subscription_packages` cannot be consumed; transfer between
owners preserves the total. Tests run in CI.

For config rollout safety, add a `config_snapshots` table that captures
the row state before any UI mutation on `organizations`,
`email_settings`, `notification_settings`, `location_hours`, and any
`*_settings` row. Add an "Undo last change" affordance on the relevant
Settings pages. This is partly defensive but addresses the specific Gingr
complaint about configurations flipping after a rollout.

For feeding reports staleness, read the staff feeding UI to confirm it
refetches on room-group switches. Marked `unknown` until that inspection
runs.

## Cluster 2: Customer support architecture

The brief is right that this is mostly an ops decision. Snout cannot
decide for the user whether they hire human chat support or buy a
Statuspage subscription. What the product can do is expose hooks so
whatever support model the operator chooses is visible inside the app.

Snout has the support shell now. `components/portal/support/SupportWidget.tsx`
provides a tabbed widget with Updates (in-product changelog), Status
(linked to `VITE_STATUS_PAGE_URL` if set), and Contact tabs. The Contact
tab carries a TODO for an Intercom / Plain / Crisp snippet — the
integration is ready when an account is provisioned. The full changelog
admin lives in `pages/portal/settings/ChangelogTab.tsx` against the
`changelog_entries` table with severity, module filtering, and
draft/published states.

In-product conversations (owner ↔ operator) remain unchanged: they exist
via `useConversations` etc. and are not what this cluster is about.

| Item | Status | Location |
|---|---|---|
| In-product live chat to a human (Snout support) | partial | `SupportWidget.tsx` shell + Contact tab; vendor JS snippet (Intercom / Plain / Crisp) not yet provisioned |
| Critical issue escalation that bypasses the queue | missing | no escalation flow |
| Status page integration showing real system health | partial | `SupportWidget.tsx` reads `VITE_STATUS_PAGE_URL`; status page itself is third-party and not yet provisioned |
| In-product changelog with opt-in change notifications | partial | Full admin + reader exist (`ChangelogTab.tsx`, `changelog_entries`); per-user opt-in email-on-publish not yet wired |

### Proposed approaches

The Support Widget is in place. Three remaining items fold together: pick
a vendor for live chat, point `VITE_STATUS_PAGE_URL` at a real Statuspage
or Instatus instance, and wire `changelog_entries.published_at` triggers
to fan-out an email to opted-in users. The changelog opt-in is a small
schema change (`profiles.changelog_email_optin` boolean) plus a cron that
queries `changelog_entries WHERE published_at >= NOW() - INTERVAL '1
DAY'` and sends through the existing `send-email` infra.

For escalation, the cleanest version is a "Report critical issue" link in
the Support Widget that POSTs to a Snout-side endpoint. Out of scope
until the live-chat vendor decision is made — the same vendor usually
handles escalation.

## Cluster 3: Payment processor flexibility and fee transparency

Snout is no longer single-processor. Helcim is wired alongside Stripe
Connect. The `helcim_accounts` table holds the per-org Helcim auth state,
and `App.tsx` routes `getPaymentProcessor()` to the correct path
depending on `organizations.payment_processor`. POS forms render against
either provider. This closes the Western Canadian "operator who uses
Helcim" complaint cleanly.

Surcharge passthrough is also live. `surcharge_settings` per organization
controls enabled / rate (basis points) / applies-to-credit-only / customer
notice text / network-registration acknowledgment. The 2.4% Canadian cap
is enforced in `lib/surcharge.ts` (`CANADIAN_SURCHARGE_CAP_BP = 240`).
Cart calls `surchargeApplies()` and `calculateSurchargeCents()`, then
writes the surcharge as a separate line on the invoice.

Expected payout dates surface on invoices. Stripe webhook populates
`payment_payouts.expected_payout_at` (from balance-transaction
`available_on`); `InvoiceDetail.tsx` lines 496–500 render "expected to
land in your bank on …".

Fee-change notification with notice period is still missing.
`pricing_change_notices` table does not exist.

| Item | Status | Location |
|---|---|---|
| More than one integrated processor | covered | Stripe Connect + Helcim. Helcim functions live; `App.tsx:138-175` routes by org config |
| Bring-your-own merchant account without losing functionality | covered | Stripe Connect is BYO; Helcim auth is per-org |
| Payout timing visible in-product per transaction | covered | `payment_payouts.expected_payout_at`; `InvoiceDetail.tsx:496-500` |
| Surcharge passthrough on every supported processor | covered | `surcharge_settings`, `lib/surcharge.ts`, `SurchargeTab.tsx`, POS cart writes surcharge line |
| Published, non-quote-driven SaaS pricing | not applicable | ops decision |
| Fee change requires in-product notification with notice period | missing | no `pricing_change_notices` table; no banner mechanism |

### Proposed approaches

For fee-change notification, add a `pricing_change_notices` table with
`effective_at` (>= 30 days out), `title`, `body_md`, and a per-staff
acknowledgment table. Every staff session reads the table on login and
shows a banner; `effective_at - now()` is the visible countdown. A
snapshot test asserts the banner renders when a notice exists.

Square Canada and Moneris remain unsupported. Helcim is the more popular
Western-Canadian processor and is now in place; whether Square and
Moneris become priorities depends on operator demand.

## Cluster 4: Operator UX

This cluster has narrowed the most. Three of the four flagged items have
shipped. The remaining gap is per-location report filtering.

Booking time defaults derive from `location_hours` per day-of-week, both
on initial load and on date change (re-derives unless the user has
manually edited). Time-picker dropdown range is computed from
`MIN(open) ... MAX(close)` across configured days. Closed days surface a
warning banner.

Phone-number search is live (`OwnersList.tsx`).

Per-reservation-type message templates are live: `message_templates`
table with `(organization_id, channel, event_type, service_module)` plus
`subject`, `body`, `active`. `lib/message-templates.ts` resolves
most-specific-first with fallback to hardcoded defaults. The four
existing senders (`reservation_confirmation`, `invoice_created`,
`report_card_published`, `waiver_reminder`) plus two more in the resolver
(`reservation_reminder`, `birthday`) all flow through `resolveOrFallback`.
`MessageTemplatesTab.tsx` is a 464-line CRUD UI with token discovery and
live preview.

Pets without photos: `PetsList.tsx:29,61-62,129-138` — three-state
filter (any / with photo / missing) shipped.

Multi-service first-class is unchanged from before — `module_enum`
schema, `parent_reservation_id` for add-ons.

| Item | Status | Location |
|---|---|---|
| Front-desk click counts under four for routine actions | partial | not yet timed; structure suggests under-four for check-in/out, edit-to-switch-service unbenchmarked |
| Drop-off and pick-up defaults derive from facility hours | covered | `StepDateTime.tsx`, `defaultsForDate()` helper, date-change re-derive, picker range from `pickerRangeFromHours()` |
| Phone-number search | covered | `OwnersList.tsx` |
| SMS and email templates customizable per reservation type | partial (email yes, SMS no) | `message_templates` + resolver + `MessageTemplatesTab.tsx`; SMS rows allowed by schema but no SMS sender exists |
| Reports: memberships started or cancelled in date range | partial | `analytics/tabs/CustomReportsTab.tsx` has the data plumbing; report definition exists but per-location filter not yet exposed |
| Reports: true occupancy percentage | covered | `OccupancyTab` calculates `occupiedRuns/totalRuns` |
| Reports: pets without photos | covered | `PetsList.tsx` photo filter |
| Multi-service first-class data model | covered | `module_enum`, equal handling across services table |
| Reports: per-location filter | missing | `pages/portal/reports/Reports.tsx` does not consume `useLocationFilter` |

### Proposed approaches for partial / missing items

For the front-desk click count benchmark, walk a fresh staff PIN through
the five most-frequent flows (check-in, check-out, switch reservation
type, add an add-on, refund) and time/click-count each. File the results
as `docs/click-counts-2026-Q2.md`. If switching reservation type is over
four clicks, add an inline service-swap action on the detail page row.

For per-location reporting, add a `location_id` filter pill on each
Reports tab (Revenue, Clients, Pets, Occupancy, Custom Reports) that
applies through the existing `useLocationFilter` context. Per-tab change,
not large.

For the memberships report, expose the existing data plumbing as a named
report ("Memberships started") with start/end date pickers and a CSV
export.

## Cluster 5: Pet parent (customer-facing) mobile experience

This cluster has changed the most. Snout now has:

- **A native iOS app**: `apps/ios/` is real with 704 Swift files, an
  Xcode project generated from `project.yml`, supabase-swift SDK
  integration, and Resources/Config.plist (gitignored).
- **Push notifications**: `supabase/functions/send-push-notification`
  and `supabase/functions/dispatch-owner-push` exist;
  `apps/web/src/lib/push.ts` provides `dispatchOwnerPush`; the
  `push_subscriptions` table stores per-device tokens. Email senders in
  `lib/email.ts` fan out a push beside every transactional email
  (`firePushBeside`).
- **A live webcam viewer**: `webcams` table + `WebcamPlayer.tsx` for
  rendering HLS / mp4 / iframe sources + `WebcamsTab.tsx` for operator
  setup + `Webcams.tsx` (owner-facing) that filters cameras to
  locations where the owner has an active reservation.
- **Photo / video download with filename**: `pages/portal-owner/PetDetail.tsx`
  uses `withDownloadFilename(signedUrl, filename)` with an `<a>` carrying
  both the URL `download` parameter and the HTML `download` attribute.

What remains: a per-form audit of optional vs required fields, the
multi-pet single-deposit math verification, and the booking-flow tap
count benchmark on mobile web.

| Item | Status | Location |
|---|---|---|
| Native mobile app (iOS) | covered | `apps/ios/` (704 Swift files); supabase-swift SDK; XcodeGen `project.yml` |
| Native mobile app (Android) | missing | `apps/android/` is still a placeholder |
| Push notifications for report cards, photos, bookings, reminders | covered | `send-push-notification` + `dispatch-owner-push` + `push_subscriptions`; `firePushBeside` in `lib/email.ts` fans out alongside email |
| Photo and video download flow with correct filename | covered | `withDownloadFilename(signedUrl, filename)` in `pages/portal-owner/PetDetail.tsx` |
| Live webcam viewer (rotation, pinch zoom, full screen) | covered | `webcams` table; `WebcamPlayer.tsx`; owner-facing `Webcams.tsx` filters to active reservations |
| Auto-logout timer | not applicable | no aggressive timer in place |
| Password manager and Apple-generated password compatibility | unknown | per-form `autocomplete` audit not run |
| Optional fields | unknown | per-form audit not run |
| Form data persistence through backgrounding | not applicable on web | iOS native shell handles this differently |
| Booking flow tap count under eight | unknown | not benchmarked on mobile web |
| Multi-pet reservation single deposit | unknown | needs inspection of booking-wizard deposit math |

### Proposed approaches

For the password-manager audit, walk every login / signup / change-email
form and assert each input has the right `autocomplete` (`current-password`,
`new-password`, `email`, `username`). Single PR.

For optional-vs-required audit, walk the `portal-owner` forms and assert
each `<Input required>` corresponds to a column with a `NOT NULL`
constraint. Anything that's `required` for UX but not at the DB is a
candidate to relax. Single PR.

For tap-count benchmarking, walk the booking wizard on mobile width
(360px) and screen-record the path. If it's over eight, identify the
unnecessary step and inline it.

For multi-pet single deposit, read the deposit calculation in the booking
wizard `Review` step and confirm the deposit is computed once per
reservation, not once per pet. If wrong, single-line fix.

Android remains an explicit deferral. Adding it is a separate engagement.

## Secondary complaints

Onboarding playbook: documentation, not code. The `pages/onboarding`
flow exists; the "not charged before go-live" guarantee is a
billing-and-Stripe matter.

QuickBooks Online integration: **shipped end-to-end** across the
`feature/quickbooks-sync-*` branches. Customers, items, invoices (with
per-line tax codes), payments (succeeded + refunded), payouts (Journal
Entry shape), tips (Journal Entry to Tips Payable), and per-credit-type
deferred revenue are all syncing. Reconciliation export and a "failed
syncs" surface land in the Settings tab.

Zapier coverage: still missing. No `webhooks` table, no per-org webhook
subscription model, no Zapier app published.

AI phone integration (FetchDesk and similar): no documented path. Same
shape as before — expose a small set of write APIs (book reservation,
look up owner, mark deposit paid) and document them.

Multi-location: `locations`, `location_id` on reservations / services /
suites / location_hours / tax_rules are covered. Per-location coupons or
pricing rules: `pricing_rules` and `promotions` are still **org-scoped
only** — no `location_id` column on either. `owner_subscriptions` has no
`location_id` column either, so cross-location membership redemption
works by default (verify with operator if behavior is intended).

Reporting per-location: `pages/portal/reports/Reports.tsx` still does
not read `useLocationFilter` — single-PR fix flagged in Cluster 4.

Migration in: covered for Gingr, PetExec, DaySmart via the import
wizard at `pages/portal/settings/import/`. **Still missing**: MoeGo and
Time To Pet. Adding sources is mechanical (a new file under
`import/lib/` per source, plus a row in `StepSelectSource.tsx`).

Migration out: every list page (reservations, owners, pets, invoices,
analytics) has CSV exports. There is **no single "download all my data"
button**. Adding an export of the full set as a zip would close the
trust signal — one Supabase function plus a Settings page button.

Canadian-specific functionality: `tax_rules` per location is in place
(GST, PST, HST). Stripe Canada is the processor; Helcim is now joined.
SMS routing remains moot (no SMS). Date and currency formatting: most
paths use `toLocaleDateString` with implicit locale, which on Canadian
browsers shows ISO-ish dates.

Self-wash and one-to-one grooming: no specific code for self-wash.
Grooming module exists; one-to-one is the default for grooming.
Self-wash remains unknown.

| Item | Status |
|---|---|
| Onboarding playbook documentation | partial |
| Self-service onboarding path | partial |
| Customers not charged before go-live | unknown |
| QuickBooks Online integration | covered |
| Zapier coverage | missing |
| AI phone integration path | missing |
| Multi-location config (hours, services, taxes) | covered |
| Multi-location coupons, retail, SMS templates, pricing | missing | `pricing_rules` / `promotions` lack `location_id`; SMS missing; retail needs separate read |
| Multi-location membership redemption | partial | `owner_subscriptions` lacks `location_id`; behaviour is location-agnostic by default — confirm intent |
| Reporting per-location and consolidated | missing | `Reports.tsx` does not consume `useLocationFilter` |
| Import from Gingr, PetExec, DaySmart | covered |
| Import from MoeGo and Time To Pet | missing | `StepSelectSource.tsx` lists only the three legacy sources |
| Bulk export of customer data | missing | per-list CSV exports yes; "download everything" button no |
| GST, PST, HST per province | covered |
| Canadian processor support: Moneris, Helcim, Square Canada | partial | Stripe + Helcim live; Moneris and Square not |
| Canadian SMS routing | missing | no SMS infrastructure at all |
| Canadian date and currency formatting | unknown | verify locale paths |
| Self-wash workflow | unknown | no `self_wash` references in services or modules |
| One-to-one grooming workflow | covered |

## Most-wanted features

Native staff and facility mobile app: **iOS shipped**; Android still
missing.

True occupancy percentage: covered (Analytics OccupancyTab).

Customizable SMS and email templates by reservation type: **email
covered**. SMS row support exists in `message_templates` schema
(`channel = 'sms'`) but no SMS sender exists.

Longer SMS retention: not applicable until SMS exists.

Faster payouts: Stripe Connect default in Canada is two business days.
**Expected payout dates now surface in-product** (`InvoiceDetail.tsx`
lines 496–500), so the "show me when this lands" gap is closed.

Surcharge passthrough where regulation allows: **covered**
(`surcharge_settings`, `lib/surcharge.ts`, POS cart integration, 2.4%
Canadian cap).

Choice of payment processors: **partial** — Stripe + Helcim. Square
and Moneris not.

Deeper QuickBooks Online sync: **covered**.

Useful Zapier coverage: missing.

AI phone integration support: missing path documentation.

Enclosure type memory on rebooking: **covered**.
`pets.preferred_kennel_run_id` cached via trigger on
`kennel_run_assignments`; surfaced on the pet profile.

Automated birthday emails: **partial**. Template event `birthday`
exists in the resolver and message-templates tab, but no scheduled cron
sends. Add a nightly Supabase function that finds pets with
`date_of_birth` matching today's month + day, looks up the owner, and
sends. Couple of hours of work.

Filter for pets without photos: **covered**.

Full screen and rotation on live webcam: **covered**.
`WebcamPlayer.tsx` supports HLS / mp4 / iframe with picture-in-picture
and full-screen via the standard HTML video API.

Reliable push notifications: **covered**.
`send-push-notification` + `dispatch-owner-push` + `push_subscriptions`.

Working photo and video download: **covered**. `withDownloadFilename`
helper.

Human live chat support: ops decision — Support Widget shell is ready.

Offline printable customer and pet forms: missing. The agreements
system supports digital signatures, but no PDF intake-form template
generator exists. Add a "print blank intake form" button that renders
the org's intake template as a PDF.

## Where Snout is already ahead of the brief

The brief assumes a list of features will need to be built; in several
cases Snout already has them or has the right substrate.

Multi-service data model is unchanged from the original audit: daycare,
boarding, grooming, training, and retail are equally first-class via
`module_enum`. The Pack View distinguishes Reservation from Service
columns to reinforce this in the UI.

The activity log subsystem with actor attribution is built and renders
on reservation detail pages. The Audit Log page in Settings is
operational with action / entity / actor / date filters plus CSV export.

The migration wizard accepts Gingr, PetExec, and DaySmart exports with
column auto-mapping.

Multi-location is real at the schema level. `locations` is first class
with timezone, hours, and tax rules. Reservations, services, suites, and
tax rules carry `location_id`.

Tax handling is location-scoped through `tax_rules` (GST / PST / HST per
province).

Stripe Connect is BYO from the operator's perspective. Helcim joined
since the original audit.

Email delivery is logged with status, message id, recipient, error
message, and email type per send via `email_log`.

Phone-number customer search works.

Analytics has a true Occupancy tab. Revenue, Clients, Pets, and Custom
Reports tabs are present.

Conversations and messages exist for owner-to-operator chat.

The `AuditLog` page provides a queryable record with CSV export.

Owner credits surface in three forms: flat counters on `owners` with
atomic deduction and half-to-full conversion, manual adjustment UI on
the owner profile with activity-log entries, and the older
`subscription_packages` plus `owner_subscriptions.remaining_credits`
ledger that integrates with POS. Both have unit + integration test
coverage now.

The data model enforces one pet per reservation through the unique
constraint on `reservation_pets.reservation_id`.

**New since the original audit**:
- Native iOS app, 704 Swift files
- Live webcam viewer, owner-facing
- Push notifications wired alongside every transactional email
- Helcim as a second processor
- Surcharge passthrough with Canadian regulatory cap
- Per-event message templates with per-service-module overrides
- In-product changelog with severity / module filters / draft state
- Support Widget shell with status-page and contact tabs
- Capacity-aware oversell triggers on kennel runs and suites
- Cached preferred kennel run on pets
- QuickBooks Online integration (customers, items, invoices, payments,
  refunds, payouts, tips, deferred revenue)
- Vitest unit + integration test suites for credits, reports,
  surcharge, suite capacity, and message templates

## Open questions

These survive the refresh because they need an operator decision before
implementation:

How is the credit system unification meant to land: do the flat
counters on `owners` win and the `subscription_packages` consumption
get rewritten to write into them, or does the ledger model win and the
flat counters get derived as a view? Both have tests now, but they
still don't synchronize.

Is Android a near-term priority or long-deferred? iOS is real; Android
is a placeholder. Building Android Native is a separate engagement of
similar scope to the iOS one.

Which Canadian processors beyond Stripe + Helcim? Moneris is widely
used; Square Canada is increasingly common in retail-adjacent
businesses. Pick zero / one / both.

Is self-wash a real product requirement for your target customer? A
significant percentage of Western Canadian small-operator pet-care
businesses run a self-wash bay. If yes, it's a first-class workflow.

Is SMS the next big build? Reservation reminders and waiver reminders
are the obvious wins. The whole infrastructure (`sms_log`,
`send-sms` function, Twilio account, A2P 10DLC registration) is a
single integration of known scope (5–7 days of focused work).

What's the Zapier / public-webhook timeline? It's a real ops project
plus a published Zapier app, not just code.

## Proposed scope ordering for next batches

Each batch is a separate branch and PR, isolated from the others. Brief
estimates assume uninterrupted focus.

**Batch A — config snapshot safety (1–2 days).**
`config_snapshots` table, snapshot-before-mutate triggers on the
relevant `*_settings` tables, "Undo last change" button on each
Settings tab. Closes one of the more visible reliability complaints
without touching anything customer-facing.

**Batch B — SMS pipeline (5–7 days).**
`send-sms` Supabase function (Twilio), `sms_log` table mirroring
`email_log`, A2P 10DLC long-code, reservation-reminder + waiver-reminder
sends. Leverages `message_templates.channel = 'sms'` rows that the
schema already accepts.

**Batch C — multi-location reporting + pricing (3–4 days).**
- Add `location_id` to `pricing_rules`, `promotions`, and
  `owner_subscriptions` (nullable; null means org-wide).
- Wire `useLocationFilter` into `pages/portal/reports/Reports.tsx`
  per-tab.
- Verify retail items / SMS templates carry the same column.

**Batch D — credit edge-case test coverage + birthday cron (2 days).**
- Extend `credits.integration.test.ts` with refund re-credits,
  expired-package consumption, owner-to-owner transfer.
- Add a nightly Supabase function `send-birthday-emails` that uses the
  existing `birthday` event_type in `message_templates`.

**Batch E — operator usability surface (3–4 days).**
- Front-desk click-count benchmark + reservation-type-switch inline
  action.
- Per-form `autocomplete` audit on owner-portal forms.
- Bulk "download all my data" zip export.

**Batch F — fee-change notification (1 day).**
`pricing_change_notices` table + acknowledgment table + login banner.

**Batch G — additional importers (3–4 days).**
MoeGo and Time To Pet column mappers under `import/lib/`. Mechanical.

**Batch H — printable intake forms (1–2 days).**
PDF generator that renders the org's intake template as a printable
form.

**Batch I and beyond — larger lifts.**
Helcim already shipped, so Cluster 3's processor work is mostly done;
remaining Square / Moneris is operator-priority-driven.
Zapier app + public webhook subscriptions remain a separate ops
engagement.
Self-wash workflow needs an operator scope conversation first.
AI phone integration is path documentation, not code, until a partner
relationship exists.
Android remains a separate engagement.
Live-chat vendor selection is an ops decision; the shell is ready.

Total for batches A through H, sequential, focused: roughly 18–24
days. Each can also be parallelized across people without conflicting
on the same files.

## What's been retired from this audit

These items appeared in the original audit and are no longer applicable:

- **"Test suite is effectively absent."** Six suites under
  `apps/web/src/lib/__tests__/` cover the financial paths.
- **"There is no native mobile app."** iOS is real.
- **"No push notifications."** Wired end-to-end.
- **"No SMS sending exists."** Still true — see Batch B above.
- **"Single-processor (Stripe-only)."** Helcim is live.
- **"Hardcoded drop-off / pick-up time defaults."** Driven from
  `location_hours` per day-of-week.
- **"Email templates are hardcoded."** Per-org, per-event, per-module
  templates with live preview.
- **"No QuickBooks Online integration."** Live end-to-end.
- **"No live webcam UI."** `WebcamPlayer.tsx` and owner-facing
  `Webcams.tsx`.
- **"Pets without photos: no filter."** Three-state filter on the
  Pets list.
- **"Enclosure type memory on rebooking: missing."** Cached
  `pets.preferred_kennel_run_id` with trigger.
- **"Surcharge passthrough where regulation allows: missing."** Live
  with the 2.4% Canadian cap.
- **"Faster payouts: not surfaced."** `expected_payout_at` rendered
  on invoices.
- **"No in-product changelog."** Full admin + reader at
  `ChangelogTab.tsx` against `changelog_entries`.
- **"Suite/run oversell guards: missing."** Capacity-aware triggers in
  place.
- **"No customer-upload audit log surface."** `RecentCustomerUploads`
  on the staff dashboard reads `activity_log` filtered to owners.
