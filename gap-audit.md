# Snout Competitive Hardening: Gap Audit

This document maps the Gingr complaint clusters and feature requests in the
brief to the current state of the Snout codebase. Status values are
`covered`, `partial`, `missing`, `unknown`, or `not applicable`. For every
`partial`, `missing`, or `unknown` item, a one paragraph proposal follows.

The audit was performed by reading the codebase directly. No assumptions were
imported from the brief. Where the brief presumed a feature missing that
turned out to exist, that is noted in the section "Where Snout is already
ahead of the brief."

## Top-line read

Snout's structural foundations are stronger than the brief presumes. The
service data model treats daycare, boarding, grooming, training, and retail
as equally first-class via a `module_enum`, not as variants of a daycare
default. Activity logging, multi-tenant org isolation, multi-location
support, an audit log UI, a CSV migration wizard with mappers for Gingr,
PetExec, and DaySmart, an in-product conversations subsystem, an analytics
page with a true occupancy tab, and a Stripe Connect bring-your-own-account
flow are all present. Tax handling is location-scoped through a `tax_rules`
table, which gives provincial GST, PST, and HST handling a real seat.

The exposed weaknesses are concentrated in three places. First, the test
suite is effectively absent (one trivial example test in `src/test`).
Reliability claims are not backed by automation. Second, there is no native
mobile app, no push notification infrastructure, no SMS sending
implementation despite a `communication_pref` enum that admits SMS, and no
webcam streaming. The pet parent experience runs through the web portal
only. Third, several operator UX defaults that the brief flags
specifically (drop-off time defaults, email and SMS templates per
reservation type, processing fee passthrough) are hardcoded or absent.

The recommended ordering at the end of this document weighs frequency,
revenue impact, and effort.

## Cluster 1: Reliability and billing accuracy

The single largest sentiment driver in the Gingr corpus is operators losing
money to silent bugs. The defensive posture here is automated tests on the
financial paths and observable audit trails on every customer-facing
upload, send, and credit movement.

Snout's email send pipeline, in `supabase/functions/send-email/index.ts`,
already writes to an `email_log` row on every send with status, message id,
recipient, error message, and email type. That is a real delivery log, not
a sent boolean. The corresponding lift on the SMS side is unbuilt: no
Twilio or other SMS provider integration exists in `src` or in the
Supabase functions tree, even though `communication_pref` includes `sms`.
Vaccinations have a customer-side upload flow in
`src/components/portal-owner/VaccinationFormDialog.tsx` and a status
indicator, but I did not find an operator-facing inbox or notification
when a customer uploads a new vaccination, which is the exact surface the
Gingr "silent failure" complaint targets.

The just-shipped `activity_log` work covers reservation lifecycle changes
and actor attribution. Package credits live in two parallel systems that
do not synchronize: the new flat counters on `owners` (covered by
`src/lib/credits.ts` with atomic deduction, concurrency guard, and a
half-to-full conversion rule) and the older `subscription_packages` plus
`owner_subscriptions.remaining_credits` ledger that POS already integrates
with. Neither is covered by automated tests. The Gingr complaint that
package credits silently fail to deduct is the highest-stakes test gap in
Snout today.

Configuration rollout safety (operators reporting closed days flipping to
open, payment terminals reactivating) is unaddressed. Snout has no config
snapshot or diff capability. A schema migration that disturbs an org's
configuration row would propagate without a notification or rollback. The
brief's "config snapshot and diff" recommendation is the correct one.

| Item | Status | Location |
|---|---|---|
| Customer uploads write to operator-visible audit log | partial | `email_log` written by send-email; no equivalent for vaccination uploads or document uploads |
| Email delivery log with provider response | covered | `supabase/functions/send-email/index.ts`, table `email_log` |
| SMS delivery log with provider response | missing | no SMS sending exists |
| Package credit logic covered by automated tests | missing | `src/lib/credits.ts` is uncovered; the older `subscription_packages` consumption path is uncovered |
| Edge cases: refunded reservations, partial redemptions, transferred credits, expired packages, concurrent redemption | missing | no tests for any of these paths |
| Financial reports tie out to underlying transactions | partial | `src/lib/reports.ts` `fetchEndOfDay` reads invoices and payments; no reconciliation test in suite |
| Config rollouts cannot revert per-facility settings | missing | no config snapshot mechanism |
| Room or suite assignment cannot oversell | partial | suite, kennel run, and capacity_settings tables exist with capacity counts; no assertion test that a second assignment to a full unit is rejected |
| Feeding reports stable across room group switches | unknown | `pet_feeding_schedules` and `pet_care_logs` tables exist; need to inspect `Feeding` UI for the staleness pattern |

### Proposed approaches for partial and missing items

For uploaded-document audit, add a `customer_upload_log` table or extend
`activity_log` with `entity_type = 'document'` and write rows from every
client-side upload mutation (vaccinations, intake forms, agreements,
report-card photos). Add a "New uploads" surface on the staff dashboard
that reads this log within the last seven days. The activity log already
exists; this is mostly schema and writing rows in three places.

For SMS, add a `sms_log` table mirroring `email_log`, ship a
`supabase/functions/send-sms/index.ts` against Twilio (Canadian number
support, A2P 10DLC long-code), and back the existing communication_pref
preference with actual sends. Reservation reminders and waiver reminders
are the obvious first send paths. Provider response codes from Twilio go
into a `metadata` jsonb on the log row.

For package credit tests, write a Vitest suite that exercises
`tryConsumeCredits` against a Supabase test schema. Cover:
sufficient balance deducts and emits one row in activity log; insufficient
balance returns `{used: false}` and does not mutate; concurrent
deductions race-test where two transactions try to spend the last credit
and exactly one wins; refunded reservation re-credits; expired
subscription_packages cannot be consumed; transfer between owners
preserves the total. The test suite is the deliverable that earns the
trust the brief is asking for.

For financial reconciliation, add a single test in
`src/lib/__tests__/reports.test.ts` that seeds a small set of invoices,
payments, and refunds for a date range, runs `fetchEndOfDay` and
`fetchRevenueByDate`, and asserts equality between the totals and a
direct sum from the seed. Run it in CI on every PR.

For config rollout safety, add a `config_snapshots` table that captures
`organizations` row, `email_settings`, `notification_settings`,
`location_hours`, and any `*_settings` row before any UI mutation. Add an
"Undo last change" affordance on the Settings pages. This is partly
defensive theater because legitimate changes still need to ship, but it
addresses the specific Gingr complaint that operators woke up to flipped
configurations after a rollout.

For oversell prevention, add a unique partial-index or assertion test on
suite assignment, similar to the constraint we just added on
`reservation_pets.reservation_id`.

For feeding reports staleness, I need to read the staff feeding UI to see
if the room-group switching path triggers a refetch. Marked unknown until
that inspection runs.

## Cluster 2: Customer support architecture

The brief is right that this is mostly an ops decision, not a product
feature. Snout cannot decide for the user whether they hire human chat
support or buy a Statuspage subscription. What the product can do is
expose hooks so that whatever support model the operator chooses is
visible inside the app.

Snout has an in-product `conversations` and `messages` subsystem with
`useConversations`, `useSendMessage`, and `useMarkConversationRead`
hooks. This is consumer-to-staff messaging (a pet owner messaging the
facility), not operator-to-Snout-support messaging. The latter does not
exist. There is no in-product changelog, no status page widget, and no
critical-issue escalation path.

| Item | Status | Location |
|---|---|---|
| In-product live chat to a human (Snout support) | missing | `conversations` is owner to operator, not operator to vendor |
| Critical issue escalation that bypasses the queue | missing | no escalation flow |
| Status page integration showing real system health | missing | no status page reference anywhere |
| In-product changelog with opt-in change notifications | missing | no changelog page |

### Proposed approaches

The fastest credible path is the same as Linear and Vercel: a small widget
in the bottom-right that links to a Statuspage instance, a changelog page,
and an Intercom or Plain.com chat. Each is a third-party integration
behind a small React component. The product work is one
`SupportWidget` component, three environment variables, and an admin
toggle in `settings`. Total code surface is small. This is a roadmap
item not a feature build, and the operator policy must be in place to
back it (response-time target, on-call rotation, escalation tree).

If you do not want third parties, the changelog is the cheapest internal
build. A `changelog` table with `published_at`, `title`, `body_md`,
`affects_modules` (array), and a settings opt-in for email
notifications. Render in the staff portal under a bell icon.

## Cluster 3: Payment processor flexibility and fee transparency

Snout uses Stripe Connect. The integration is built around a
per-organization Stripe account, set up via
`stripe-connect-onboarding-link` and tracked in `stripe_connect_accounts`.
This is technically bring-your-own (the merchant owns the Stripe account
and the funds), so the brief's "lock-in" framing does not apply cleanly
to Snout. What is true is that Snout is single-processor: Helcim,
Moneris, Square, Clover, and the rest are unsupported. The Western
Canadian operator who uses Helcim or Moneris has no Snout integration.

There is no surcharge passthrough capability anywhere in the codebase
(grep for `surcharge`, `processing_fee`, `service_fee` returns nothing).
Stripe Canada surcharging is permitted under the 2022 Visa and Mastercard
settlement, with the registration and notice requirements that operators
must follow. The current product blocks an operator from offering
this.

Pricing transparency for Snout's own SaaS pricing is outside the
codebase; that is an ops choice. Internally there is no fee-change
notification flow that would warn operators if Snout itself adjusted
something.

Stripe payouts in Canada default to two business days for new accounts.
The product does not surface expected payout timing per transaction; the
information lives in the Stripe dashboard but is not pulled into Snout.

| Item | Status | Location |
|---|---|---|
| More than one integrated processor | missing | only Stripe Connect (`useStripeConnect`, `supabase/functions/stripe-*`) |
| Bring-your-own merchant account without losing functionality | covered | Stripe Connect is BYO; operators own their account |
| Payout timing visible in-product per transaction | missing | not surfaced |
| Surcharge passthrough on every supported processor | missing | no surcharge code anywhere |
| Published, non-quote-driven SaaS pricing | not applicable | ops decision |
| Fee change requires in-product notification with notice period | missing | no notification flow exists |

### Proposed approaches

Helcim is the highest-priority second processor for Western Canadian
operators. Helcim's Smart Terminal and Helcim Hosted Pay can be
integrated through their REST API. The work is:
build `supabase/functions/helcim-charge`, `helcim-refund`, and
`helcim-webhook`; abstract the existing `payments` table writes so
either processor can satisfy them; add a `processor` column to
`stripe_connect_accounts` (or rename the table) discriminating which
provider. Approximately one to two weeks of focused work plus testing.

Moneris is a second tier. Square Canada is a third.

For surcharge passthrough, add `surcharge_settings` per organization and
per location: enabled, rate basis points, applies to credit only or
credit-and-debit, customer notice text. On the POS cart, when surcharge
applies, render the surcharge as a separate invoice line, write it to
`invoice_lines.line_type = 'surcharge'`, and ensure tax handling is
correct (surcharges may or may not be GST-able depending on the
jurisdiction; consult provincial rules). Test with the Visa and
Mastercard 2.4% cap. The Canadian regulatory caveat is real and should
be in the in-product help for the setting.

For payout timing, pull from the Stripe Connect API
(`balance_transactions` with `expected_availability_date`) and surface
on the closed invoices page. This is one query change plus a small UI
addition.

For the fee-change notification, this is a process not a product. If
Snout's pricing changes, an internal admin action writes a row to
`pricing_change_notices` with `effective_at` at least 30 days out, and
every staff session reads the table on login and shows a banner. The
test for this would be a snapshot test that the banner renders when a
notice exists. Cheap. Worth building.

## Cluster 4: Operator UX

Front-desk click counts: I did not run the timed click-by-click
benchmark the brief asks for. The Pack View we just shipped puts
"Check In" one click away from the Coming In tab and "Check Out" one
click away from the In The Pack tab, which is on par with the strongest
operator UX in the category. Switching a daycare reservation to
overnight boarding requires an Edit, which means at minimum two clicks
and probably more (open detail, click Edit, change service, change
times, save) — that is the kind of routine that the brief wants
under four clicks and probably is not. Verify with a real timed pass.

Drop-off and pick-up time defaults are hardcoded in
`src/components/portal-owner/booking-wizard/StepDateTime.tsx`: hourly
defaults to 09:00, full-day defaults to 07:00 to 18:00, overnight to
14:00 to 11:00. They are not derived from `location_hours`. This
matches the Gingr "12 AM default" complaint exactly: a hardcoded value
that ignores facility configuration.

Phone-number search exists in `OwnersList` (`phone.ilike.%term%`).
Working.

Email templates are hardcoded in `src/lib/email-templates.ts` per email
type (reservation, invoice, report card, waiver). The
`email_settings` table has only a global on/off and a sender_name,
nothing per-reservation-type. SMS templates do not exist (no SMS at
all). Customizable templates per reservation type is the gap.

Reports: there is a Reports.tsx page (financial, occupancy, end-of-day)
and an Analytics section with Clients, Pets, Revenue, Occupancy, and
Custom Reports tabs. The named brief reports (memberships started or
cancelled in a date range, true occupancy percentage, pets without
photos) are partially covered: occupancy is real (the OccupancyTab
calculates `occupiedRuns/totalRuns`); membership churn is unknown
until I read CustomReportsTab; pets without photos is missing (no
`photo_url IS NULL` filter exists anywhere).

Multi-service first-class: confirmed at the data model level. The
`module_enum` is `daycare | boarding | grooming | training | retail`.
Reservations have a single `service_id` with `parent_reservation_id`
for add-on linkage (just shipped). This is structurally not
daycare-first.

| Item | Status | Location |
|---|---|---|
| Front-desk click counts under four for routine actions | partial | Pack View Check In and Check Out are one click; reservation type switching is unknown |
| Drop-off and pick-up defaults derive from facility hours | missing | hardcoded in `StepDateTime.tsx` |
| Phone-number search | covered | `src/pages/portal/owners/OwnersList.tsx:62` |
| SMS and email templates customizable per reservation type | missing | `email_settings` is global; `email-templates.ts` is hardcoded; no SMS at all |
| Reports: memberships started or cancelled in date range | unknown | depends on CustomReportsTab capability |
| Reports: true occupancy percentage | covered | `OccupancyTab` calculates `occupiedRuns/totalRuns` |
| Reports: pets without photos | missing | no filter for `photo_url IS NULL` |
| Multi-service first-class data model | covered | `module_enum` and equal handling across services table |

### Proposed approaches

For booking time defaults, change `StepDateTime.tsx` to read from
`location_hours` for the day-of-week of the selected date and use those
as defaults. Falls back to the current hardcoded values when hours are
not set. This is one component change plus one query.

For per-reservation-type templates, add a `message_templates` table
keyed by `(organization_id, channel, event_type, service_module)` with
an HTML or plain body and merge variables. Override resolution: most
specific template wins (per service module), falling back to the
channel default (`event_type`). Build a Settings tab to edit templates
with a live preview, and migrate the hardcoded defaults from
`email-templates.ts` into seeded rows. The hooks call the resolver, not
the hardcoded function.

For pets-without-photos, add a filter pill on the Pets list that issues
`.is("photo_url", null)`. One UI change plus one query branch.

For memberships started or cancelled, read CustomReportsTab and either
add the report or document that it is missing.

For switching reservation type, time it on the live app and either
shorten the path (allow inline service swap on the detail page action
row) or document as a known sharp edge.

## Cluster 5: Pet parent (customer-facing) mobile experience

This is where Snout has the largest gap from the brief. Snout has no
native mobile app. There is no Expo, Capacitor, or React Native code in
`package.json`. The pet parent experience is the `portal-owner` web
pages served at the same domain as the staff portal. There are no push
notification implementations: no Firebase Cloud Messaging, no APNS, no
Web Push subscription logic, no service worker. There is no live
webcam UI anywhere in the codebase.

This means the brief's mobile-specific complaints (auto-logout,
keyboard re-render, pinch zoom, app backgrounding losing form data) do
not apply because there is no mobile app to apply them to. The right
question is whether the strategy is to ship a native app or to harden
the mobile-web experience. The brief seems to assume native.

Web-based items the brief surfaces that Snout can verify today:
- Photo and video downloads from owner-facing pages: I did not find a
  download flow with a forced filename, so this is partial at best.
- Push notifications: not possible on iOS Safari without a PWA install,
  marginal on Android. Real native push requires the app.
- Form fields optional vs required: requires a per-form audit that I
  did not run.
- Multi-pet single deposit: the booking wizard exists in
  `src/components/portal-owner/booking-wizard`. It supports multiple
  pets per reservation in `StepPets.tsx`, but the deposit math needs
  inspection to confirm a single deposit for the reservation rather
  than per pet. Marked unknown.
- Booking flow tap count: the wizard is a four step flow (Service,
  DateTime, Pets, Review). On a desktop browser this is plausibly
  under twelve taps. On mobile web with a long pet list, less certain.

| Item | Status | Location |
|---|---|---|
| Native mobile app (iOS, Android) | missing | no native shell exists |
| Push notifications for report cards, photos, bookings, reminders | missing | no FCM, no APNS, no Web Push |
| Photo and video download flow with correct filename | partial | needs read of `ReportCardDetail.tsx` and friends |
| Live webcam viewer (rotation, pinch zoom, full screen) | missing | no webcam code |
| Auto-logout timer | not applicable | no aggressive auto-logout is set today; this is a non-issue |
| Password manager and Apple-generated password compatibility | unknown | depends on form input attributes; needs audit |
| Optional fields | unknown | per-form audit not run |
| Form data persistence through backgrounding | not applicable on web | not applicable to web; native concern only |
| Booking flow tap count under eight | unknown | not benchmarked; wizard is four steps |
| Multi-pet reservation single deposit | unknown | needs inspection of `BookingWizard` deposit logic |

### Proposed approaches

The native app is a strategic decision, not a feature build. The
honest read is: a competent operator-facing native app and a competent
pet-parent native app together are roughly six to nine months of
focused work for a senior team, depending on the level of feature
parity. Capacitor over the existing React app is the fastest path to
"shipped on stores" but inherits the web performance characteristics
the brief warns about. React Native is a clean rebuild of the
client-facing screens. Expo for iOS and Android with React Native paper
or a similar stack is reasonable. Defer this to a separate engagement
once you decide which kind of app you want and what the parity bar is.

For push notifications, even on web, register a service worker with
Web Push. iOS Safari now supports it for installed PWAs since 16.4. The
prompt-to-install path becomes part of the owner onboarding. Send pushes
through Firebase or directly using the VAPID protocol. This is a
medium-sized chunk of work (a week or so) but addresses one of the
brief's specific asks without requiring native.

For photo and video download, add a `?download=1` query param on the
storage URL and render `<a href download="filename">` so the file is
saved with a meaningful name. Add a test that asserts the
`Content-Disposition` header from Supabase Storage.

For webcam, this is operator-config plus a player. Most facilities use
a third-party camera (UniFi Protect, Eagle Eye, Reolink, manufacturer
RTSP feeds, or a streaming service like LiveStream Pets, Cammie, or
Petsy). The product work is: a `webcams` table per org and per
location, fields for `provider`, `embed_url`, `auth_method`, plus a
viewer component. Use HLS for browser-friendly delivery, with picture
zoom and full screen via standard HTML video controls. Native zoom
with proper anchoring needs care; use a pinch-zoom library on a
canvas or use the browser's full-screen API with CSS transform.

For password manager compatibility, audit form fields for `name`,
`autocomplete`, and `inputmode`. Add `autocomplete="current-password"`
to login, `new-password` to signup, `email` to email fields. These
attributes are what password managers and Apple keychain key off.

## Secondary complaints

Onboarding playbook: documentation, not code. The onboarding pages
under `src/pages/onboarding` (which exist) drive a self-service path
once the org is created. The "not charged before go-live" guarantee is
a billing-and-Stripe matter; the trial flag exists in
`org_status_enum` and the existing subscription pause logic looks
sound. Verify the "no charge during onboarding" path with a manual
test against staging.

QuickBooks Online integration: missing. No QBO references anywhere.
This is a real gap for $2M+ revenue operators. Likely a separate
engagement (Intuit OAuth, mapping invoices, payments, refunds, tips,
processor fees, deferred revenue for prepaid packages, classes for
location). Estimate: three to five weeks of focused work.

Zapier coverage: missing. No zapier endpoints, no public webhook
subscription model. Snout would need a `webhooks` table per org,
events for new customer, new pet, new reservation, status change,
payment, package events, vaccination expiring, report card published,
and a `webhook_deliveries` log. Plus a Zapier app published in the
Zapier directory (a real ops project, not just code).

AI phone integration (FetchDesk and similar): no documented path. To
support, expose a small set of write APIs (book reservation, look up
owner, mark deposit paid) and document them. The operations layer of
this is the partner relationship, not the code.

Multi-location: covered at the schema level. `locations` table per
org, `location_id` on reservations, services, suites, location_hours,
tax_rules. Per-location coupons or pricing rules: `pricing_rules` and
`promotions` tables exist; need to inspect whether they are
location-aware. Marked partial pending that read.

Membership redemption across locations: depends on
`subscription_packages` and `owner_subscriptions` design. The
`included_credits` and `remaining_credits` are jsonb without a
location scope, so cross-location redemption likely works by default.
Verify.

Reporting per-location and consolidated: current Reports.tsx and the
analytics tabs accept an `orgId` and a `range`, not a location filter.
Adding location filtering would be a per-tab change, not large.

Migration in: covered for Gingr, PetExec, DaySmart via the import
wizard. Not yet for MoeGo or Time To Pet. A column-mapper has the
shape needed; adding sources is mechanical.

Migration out: every list page (reservations, owners, pets, invoices,
analytics) has `downloadCsv` exports. There is no single
"download all my data" button. Adding an export of the full set
(`organizations`, `owners`, `pets`, `reservations`, `invoices`,
`payments`, `subscription_packages`, `owner_subscriptions`, documents
from Storage) as a zip would close the trust signal. One Supabase
function plus a Settings page button.

Canadian-specific functionality: tax_rules per location is in place,
which gives provincial GST, PST, HST handling. Stripe Canada is the
processor (good), Helcim and Moneris are not (gap). SMS routing is
moot (no SMS). Date and currency formatting: most paths use
`toLocaleDateString` with implicit locale, which on Canadian browsers
will show ISO-ish dates; verify.

Self-wash and one-to-one grooming: no specific code for self-wash. The
grooming module exists; one-to-one is the default for grooming
appointments. Self-wash is a different workflow (operator releases a
bay, customer uses it, retail items added at end). Need to confirm
whether facility owners using Snout for self-wash today work around
the lack or whether none of them have it. Marked unknown.

| Item | Status |
|---|---|
| Onboarding playbook documentation | partial |
| Self-service onboarding path | partial |
| Customers not charged before go-live | unknown |
| QuickBooks Online integration | missing |
| Zapier coverage | missing |
| AI phone integration path | missing |
| Multi-location config (hours, services, taxes) | covered |
| Multi-location coupons, retail, SMS templates, pricing | partial |
| Multi-location membership redemption | unknown |
| Reporting per-location and consolidated | partial |
| Import from Gingr, PetExec, DaySmart | covered |
| Import from MoeGo and Time To Pet | missing |
| Bulk export of customer data | partial |
| GST, PST, HST per province | covered (table exists; verify per-province rules) |
| Canadian processor support: Moneris, Helcim, Square Canada | missing (Stripe Canada only) |
| Canadian SMS routing | missing (no SMS) |
| Canadian date and currency formatting | unknown (verify) |
| Self-wash workflow | unknown |
| One-to-one grooming workflow | covered |

## Most-wanted features

Native staff and facility mobile app: missing. Same conversation as
the pet parent app. Strategically the most-requested item in the
Gingr corpus. A bigger commitment than any single feature in this
audit.

True occupancy percentage: covered (Analytics OccupancyTab).

Customizable SMS and email templates by reservation type: missing.
See proposal in Cluster 4.

Longer SMS retention: not applicable (no SMS).

Faster payouts: Stripe Connect default in Canada is two business days,
which is at the better end of the brief's twenty-four to forty-eight
hour ask. Showing expected dates per transaction is the in-product gap
(see Cluster 3 proposal).

Surcharge passthrough where regulation allows: missing. See Cluster 3.

Choice of payment processors: missing. See Cluster 3.

Deeper QuickBooks Online sync: missing.

Useful Zapier coverage: missing.

AI phone integration support: missing path documentation.

Enclosure type memory on rebooking: missing. Add a `last_kennel_run_id`
or `preferred_kennel_run_id` on `pets` (or read from the most recent
checked-out reservation's `kennel_run_assignments`) and pre-fill on the
next booking. Schema change plus one query change in BookingWizard.

Automated birthday emails: missing. There are stub references in
import templates and reports, but no scheduled cron sends. Add a
nightly Supabase function that finds pets with `date_of_birth` matching
today's month and day, looks up the owner, and sends an
`org-customizable` birthday email. Couple of hours of work.

Filter for pets without photos: missing. See Cluster 4.

Full screen and rotation on live webcam: missing (no webcam). See
Cluster 5.

Reliable push notifications: missing. See Cluster 5.

Working photo and video download: partial. See Cluster 5.

Human live chat support: ops decision. See Cluster 2.

Offline printable customer and pet forms: missing. The agreements
system supports digital signature flows, but no PDF printable
intake-form template generator is in the codebase. Add a "print blank
intake form" button that renders the org's intake template as a PDF.

## Where Snout is already ahead of the brief

The brief assumes a short list of features will need to be built; in
several cases Snout already has them or has the right substrate.

The data model for services treats daycare, boarding, grooming,
training, and retail equally as `module_enum` values. There is no
"daycare default with everything else bolted on." The Pack View we
just shipped distinguishes Reservation from Service columns to
reinforce this in the UI. This is the structural complaint about
multi-service businesses, and it is solved at the schema level.

The activity log subsystem with actor attribution (staff PIN, owner,
or system) is built and is rendered on reservation detail pages. It
filters status changes (which appear in the Status timeline) so
Activity covers edits, comments, payments, and other non-status
events. The Audit Log page in Settings is operational with action,
entity, actor, and date filters plus CSV export.

The migration wizard accepts Gingr, PetExec, and DaySmart exports
with column auto-mapping. This is the migration-in story the brief
asks for.

Multi-location is real at the schema level. `locations` is a first
class table with timezone, hours, and tax rules. Reservations,
services, suites, and tax rules all carry `location_id`.

Tax handling is location-scoped through `tax_rules`, which gives
GST, PST, and HST a real seat per province for a multi-location
operator across Canada.

Stripe Connect is bring-your-own from the operator's perspective: the
merchant owns the Stripe account, not Snout. The brief frames Gingr
as having "lock-in"; Snout does not have that specific lock-in.
The gap is single-processor, not lock-in.

Email delivery is logged with status, message id, recipient, error
message, and email type per send via `email_log`. Resend is the
provider, and the function in `supabase/functions/send-email`
captures provider response codes and error messages. This is the
audit trail the brief asks for on emails specifically.

Phone-number customer search works via case-insensitive LIKE.

Analytics has a true Occupancy tab calculating `occupiedRuns/totalRuns`,
not just total bookings. Revenue, Clients, Pets, and Custom Reports
tabs are present.

Conversations and messages exist for owner-to-operator chat (not
operator-to-Snout-support).

The `AuditLog` page in `Settings` provides a queryable record of
every activity event with CSV export. Operators have a real audit
trail today.

Owner credits surface in three forms: a new flat-counter ledger on
`owners` (`daycare_full_day_credits`, `daycare_half_day_credits`,
`boarding_night_credits`) with atomic deduction at check-out and a
half-to-full conversion rule, manual adjustment UI on the owner
profile with activity-log entries, and the older
`subscription_packages` plus `owner_subscriptions.remaining_credits`
ledger that integrates with POS. The two systems do not synchronize
yet (this is the "credit system unification" follow-up flagged in
prior conversation), but the basic credit model is more developed
than the brief implies.

The data model enforces one pet per reservation through the unique
constraint just added on `reservation_pets.reservation_id`. This
matches the operator constraint mentioned in the working session and
removes the multi-pet sharing-a-reservation ambiguity that some
competitors permit.

## Open questions

Where the audit returned `unknown`, I want answers from you before
I commit to scope or implementation.

How is the credit system unification meant to land: do the flat
counters on `owners` win and the `subscription_packages` consumption
get rewritten to write into them, or does the ledger model win and
the flat counters get derived as a view? The reliability tests in
Cluster 1 cannot be designed cleanly until that is decided.

What is the strategy on native apps? If we are committing to a native
operator app and a native pet-parent app, the rest of the
mobile-experience cluster of complaints reorganizes around that
project. If we are not, several items in Cluster 5 stop being
relevant and others become PWA-flavored.

What is the Western Canadian processor priority? Helcim is my
default assumption (popular regionally, modern API, surcharge
support). Moneris is widely used but has a heavier integration. Square
Canada is increasingly common in retail-adjacent businesses. If the
target is "make Helcim work first," that is a single integration of
known scope.

Is self-wash a real product requirement for your target customer? A
significant percentage of Western Canadian small-operator pet-care
businesses run a self-wash bay. If yes, that is a first-class
workflow build, not a retrofit.

Is the QBO integration a near-term priority or a roadmap item? It is
the biggest single piece of software in the secondary list. Real
prioritization affects the next quarter.

How aggressive should the test-coverage push be? The honest answer
to the "Cluster 1 reliability" complaints is "there are no tests, so
trust is currently rhetorical." Building enough tests to back the
claim is a multi-week project even on the focused subset that the
brief flags.

## Proposed scope ordering for implementation

If the scope is approved, I would sequence the work as follows. Each
batch is a separate branch and PR, isolated from the others. Brief
estimates are working-day estimates assuming uninterrupted focus.

Batch one. Test infrastructure plus credit consumption tests. Set up
Vitest with a test schema in Supabase, write the credit-consumption
tests covering the brief's named edge cases, write the
financial-reconciliation test, and bring CI up to a state where new
PRs cannot land without passing tests. Three to five days.

Batch two. Reliability surface fixes. Customer-upload audit log
extension to cover vaccinations and documents (writing into
`activity_log` with `entity_type = 'document'`), the unique-index
oversell guards on suite and kennel-run assignments, and the booking
time defaults derived from `location_hours`. Two to three days.

Batch three. Per-reservation-type message templates plus pets-without-
photos filter plus enclosure-memory-on-rebooking. Three to four days.

Batch four. Surcharge passthrough plus payout-timing surfacing plus
fee-change notification scaffolding. Four to five days.

Batch five. Helcim integration as a second processor. One to two
weeks. Includes refactoring the payments table writes and the POS
charge path to be processor-agnostic.

Batch six. Bulk data export plus migration import for MoeGo and Time
To Pet. Three to four days.

Batch seven. Birthday emails plus printable intake forms plus support
widget plus changelog page. Three to four days.

Batch eight. SMS sending pipeline (Twilio integration, sms_log,
reservation reminders). Five to seven days.

Batch nine. Web Push notifications for owners on reservation
confirmation, report card published, and reminder. Five to seven days.

Batch ten and beyond. QBO integration, Zapier app and webhooks, native
mobile app, webcam viewer. Each is a separate engagement.

Total for batches one through nine, sequential, focused: roughly six
to eight weeks. The further-out items are larger and need their own
scope conversations.

## What I am stopping on

Per the brief's instructions, I am stopping here. No code has been
written. No batches have been opened. Tell me which of the open
questions you want to answer, which batches you want to greenlight,
and which you want to defer or rescope.
