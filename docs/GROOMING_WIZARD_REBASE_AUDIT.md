# Grooming Wizard Branch Audit

Branch: `feature/grooming-booking-wizard-rebased` (rebased on top of `origin/main`).

## Headline

- Total commits replayed during rebase: **14** (from 17 source commits — 1 merge commit dropped, 2 superseded by main)
- Conflicts hit: **11 files across 3 commits** (resolved=11, deferred=0)
- Net diff vs main: **+12,614 / −987 lines across 137 files**
- iOS xcodeproj: **64/64 swift refs resolve** to files on disk (the original 28-file Xcode Cloud failure is fixed)
- Unit test suite (`bun run test`): **56/56 passing**

## What's changing by surface

### iOS (apps/ios/)

- 103 files changed (+9,981 / −343 lines)
- 28 new Swift files / 18 modified Swift files
- New asset catalogs (Glyphs imageset bundles) and tracked SPM `Package.resolved`

**Key features added:**

- **Native booking wizard** with grooming flow — full multi-step UI (Service → Pets → Groomer → Slot picker → Date/time → Review). Mirrors web wizard's grooming branch.
  - `Views/Book/BookingWizardView.swift`, `BookingWizardViewModel.swift`, six step views under `Views/Book/Steps/`
- **Calendar tab** with per-service-module color-coded dots, contrast tier ranking by top-3 service modules, custom legend
  - `Views/Calendar/CalendarView.swift`, `VisitDetailView.swift`
- **Visit detail view + cancel flow** with policy-aware warnings (reads `organizations.cancellation_policy_hours` and the new grooming-specific window)
- **Custom tab bar** + `TabBarVisibility` service to hide nav during full-screen flows
- **More tab content** — Agreements, ClientDetails, Invoices, PaymentMethods, Pets views, MoreShared utilities (~3,500 lines)
- **Buy Credits view** with package selection and Stripe checkout-session integration (~513 lines)
- **Conversation/Messaging upgrades** — UnreadMessagesService, attachment support in ConversationView (~650 lines diff)
- **Brand refresh** — SnoutTheme additions, SnoutGlyph helper, PetAvatar component
- **Models added** for Groomer, Location, Service to support the wizard

**WIP / incomplete signals:**

- Commit `c0ddf9b` ("WIP checkpoint: grooming wizard, credit packages, message attachments, Stripe idempotency") is named WIP but the bundled work appears feature-complete on review — many of the largest views (BuyCreditsView 513 LoC, AgreementsView 704 LoC, InvoicesView 779 LoC, PetsView 1094 LoC) all land here. The "WIP" label is misleading; treat this as a checkpoint of finished work, but spot-check the views above before relying on them.
- No iOS test files were added for any of the new flows (booking wizard, calendar, credits checkout, attachments). Only the 4 pre-existing `Tests.swift` files (FormatTests, MoneyTests, StorageDownloadTests, SnoutUITestsLaunchTests) are present. Considering the volume of new view-model logic (e.g., `BookingWizardViewModel.swift`), this is a meaningful gap.

### Web app (apps/web/)

- 15 files changed (+1,286 / −642 lines)
- 4 new components/dialogs, 11 modified

**Key features added:**

- **Booking wizard grooming branch** — Step components `StepGroomer.tsx`, `StepSlot.tsx` plus heavy edits to `BookingWizard.tsx`, `StepDateTime.tsx`, `StepReview.tsx`, `StepService.tsx` and `lib/booking.ts`
  - Adds `WizardGroomer` type, `groomingDate`/`groomingSlot` state, `STEPS_GROOMING` step set; module-aware step routing via `effectiveSteps()`
- **Groomer admin UI** — three new dialogs in `pages/portal/facility/`:
  - `GroomerHoursDialog.tsx` — per-day-of-week working hours editor
  - `GroomerAvailabilityDialog.tsx` — per-date overrides (day off / different hours)
  - Edits to `GroomerFormDialog.tsx` and `GroomerManagement.tsx` to wire them in
- **Settings — cancellation policy** — `OrganizationTab.tsx` now exposes the two cancellation windows
- Email template additions in `lib/email-templates.ts`; brand polish in `index.css` and `tailwind.config.ts`

**WIP / incomplete signals:**

- The branch does NOT touch `apps/web/src/pages/portal/payments/` or anywhere a "Buy Credits" checkout entry-point would land for the web. The new edge function `create-package-checkout-session` and the `owner_subscriptions_stripe_idempotency` migration have iOS callers (BuyCreditsView) but no obvious web caller. **Either credits checkout is iOS-only by design, or the web entry-point was deferred — flag for the operator.**
- No new web tests were added. Existing test surface (postgrest, message-templates, surcharge, credits — 56 tests) still passes.

### Supabase (supabase/migrations/, supabase/functions/)

**13 new migration files (chronological):**

| File | Purpose |
|------|---------|
| `20260429180000_sync_owner_membership.sql` | Trigger: every owner with profile_id gets a `customer` membership row automatically |
| `20260429190000_mark_conversation_read.sql` | RPC `mark_conversation_read_by_owner` for pet-parent client |
| `20260429200000_add_flat_duration_type.sql` | Adds `flat` to `duration_type_enum` |
| `20260429200100_reseed_grooming_as_flat.sql` | UPDATEs existing grooming services from `hourly` to `flat` |
| `20260429210000_add_grooming_service_config.sql` | `services.default_duration_minutes` column + sets `max_pets_per_booking=1` for grooming |
| `20260429210100_create_groomer_working_hours.sql` | Per-groomer day-of-week schedule template |
| `20260429210200_get_groomer_available_slots.sql` | RPC: returns slots given (groomer, date, duration) |
| `20260429220000_create_groomer_availability.sql` | Per-date overrides table that supersedes the template for that date |
| `20260429220100_backfill_groomer_availability.sql` | Project working_hours forward 90 days into availability rows |
| `20260429220200_slot_fns_use_availability.sql` | Replaces RPC to read from `groomer_availability` instead of `groomer_working_hours` |
| `20260430000000_add_cancellation_policy.sql` | `organizations.{cancellation_policy_hours, grooming_cancellation_policy_hours}` |
| `20260430010000_add_message_attachments.sql` | `messages.attachments jsonb`, `message-attachments` storage bucket + 4 RLS policies |
| `20260430020000_owner_subscriptions_stripe_idempotency.sql` | `owner_subscriptions.stripe_checkout_session_id` + partial unique index |

**Overlap with the today-merged baseline (`20260423234000_baseline_missing_schema.sql`):**

The baseline was added to main *after* this feature branch's work was authored, and several of the columns/tables the feature branch creates are also created by the baseline. Resolution path is *temporal ordering* — the baseline (`20260423234000`) runs first, the feature migrations (`20260429*` and `20260430*`) run after. All overlapping statements use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS / CREATE POLICY` / `INSERT … ON CONFLICT DO NOTHING` so re-application is a no-op.

Specific overlaps verified:

| Object | In baseline? | In feature migration? | Resolution |
|---|---|---|---|
| `groomer_working_hours` table | yes (`CREATE TABLE IF NOT EXISTS` + idempotent constraint adds) | yes (`CREATE TABLE IF NOT EXISTS`) | Baseline creates table; feature migration is a no-op for table create, then layers RLS policies + trigger that the baseline doesn't add. ✅ Compatible. |
| `groomer_availability` table | yes | yes | Same pattern as above. ✅ |
| `messages.attachments` column | yes | yes (`ADD COLUMN IF NOT EXISTS`) | Baseline adds column; feature migration's ALTER is a no-op, then adds storage bucket + RLS policies. ✅ |
| `organizations.cancellation_policy_hours` | yes | yes | Idempotent. ✅ |
| `organizations.grooming_cancellation_policy_hours` | yes | yes | Idempotent. ✅ |
| `owner_subscriptions.stripe_checkout_session_id` | yes | yes | Idempotent; feature migration adds the partial unique index `uniq_owner_sub_stripe_session` which baseline does not have. ✅ |

**Schema risk:** none observed. No tables/columns are referenced by branch code that aren't actually created. The baseline taking ownership of overlapping columns is a happy accident — when the operator/team built the baseline from prod, the prod DB already had the feature branch's schema applied via the dashboard, so the baseline picked it up. This means the migrations on this branch are **redundant for fresh DBs** but **necessary if the prod baseline ever needed to be replayed in isolation** (and they're harmless either way thanks to idempotent guards).

**2 new edge functions:**

- `supabase/functions/create-package-checkout-session/index.ts` (NEW, 157 lines) — Stripe Checkout Session creator for credit packages, called from the iOS BuyCreditsView
- `supabase/functions/stripe-connect-webhook/index.ts` (MODIFIED, +159 lines) — Adds idempotency handling using `stripe_checkout_session_id` so replay of `checkout.session.completed` does not double-grant credits

### Tests (apps/web/src/lib/__tests__/, apps/ios/SnoutTests/)

- **0 new tests added** on this branch (web or iOS)
- Integration tests for new flows: **No** — no new integration tests for booking wizard, groomer availability, cancellation policy, message attachments, or credit checkout
- Unit test result: `bun run test` → **4 files passed, 56 tests passed, 0 failed** (run on rebased HEAD)
- Integration tests not run locally (per instructions — needs `supabase start` + Docker)

### Config / scripts / infra

- `.gitignore` (root) — minor change (1 line addition)
- `apps/ios/.gitignore` — feature branch tried to add `Package.resolved` ignore rules, conflicted with main's nuanced rules. **Resolved by taking main's version** (it correctly tracks the workspace-level `Package.resolved` while ignoring SPM build-artifact copies).
- `ci_scripts/ci_post_clone.sh` (NEW, 32 lines) — Xcode Cloud post-clone script that generates `Config.plist` from environment variables. Note: main commit `a036edd` also fixed Config.plist generation; the rebase combined both. Verify both flows still produce the right plist before relying on Xcode Cloud.
- `.github/workflows/test.yml` — feature branch added a Bun-based unit job; main already had it (more complete, with Node setup for vitest). **Resolved by taking main's version**, which dropped the feature commit `195ba6c` as a no-op.

## Recommendation

**Merge as one PR.** Caveats:

1. The branch is large (12.6k lines) and bundles iOS + web + db work. Splitting it would cost more than it would gain because the surfaces are tightly coupled — the new migrations are required by both the iOS booking wizard and the web admin dialogs. The cancellation policy reads from organizations columns shared by web (settings UI) and iOS (cancel-flow warnings). Splitting would create temporary states where one client crashes against a half-deployed schema.
2. Before merging, the operator should:
   - Spot-check the **WIP-named commit `c0ddf9b`** — even though it appears complete, verify BuyCreditsView, AgreementsView, InvoicesView, PetsView function end-to-end on a device. They are large new flows and the WIP label suggests they may not have been polished.
   - Decide whether the **missing web entry-point for credit purchases** is intentional (iOS-only by design) or an oversight. The edge function and migration support both surfaces.
   - Accept that **no new tests** ship with this branch. Given the size of the new view-model code (booking wizard, credit checkout, cancellation policy logic), this is the biggest quality risk in the bundle.
3. Once merged, run integration tests (`bun run test:integration`) in CI to confirm the new migrations apply cleanly against a fresh DB. The idempotent guards mean local-only verification can't catch ordering bugs.

## Unresolved conflicts and judgement calls

No `<!-- TODO(audit) -->` markers were committed; every conflict was resolved confidently. Notes on judgement calls made during the rebase:

| File | Decision | Rationale |
|---|---|---|
| `apps/web/src/components/portal-owner/booking-wizard/BookingWizard.tsx`, `StepDateTime.tsx`, `StepReview.tsx`, `StepService.tsx` | Took feature branch | Feature branch is the source of truth for the grooming-flow wizard architecture. Main's small adjustments (e.g., `groomerId` flat field, `default_duration_minutes` column rename) were superseded by feature's richer `WizardGroomer` type and grooming sub-state. |
| `apps/web/src/lib/booking.ts` | Hand-merged | Kept feature's new `FLAT_SERVICE_DEFAULT_DURATION_MINUTES` export (used by wizard); kept main's more recent comments and `/visit` price unit label (more recent UX vocabulary). |
| `apps/web/src/lib/money.ts` | Took main | Main's `flat: "Appointment"` is the more recent UX label. Trivial difference (`Appointment` vs `Per Appointment`). |
| `apps/web/src/pages/auth/Login.tsx` | Took main | Main uses a clean `useEffect` driven by auth-context membership for role-based redirect; feature branch had an inline `landingPathForUser` async query inside the submit handler. Main's pattern is cleaner and is one of today's stability fixes. The magic-link redirect target also differs (main: `/login`, which then redirects via the effect; feature: `/dashboard`). Took main consistently. |
| `apps/web/src/pages/portal/services/ServiceForm.tsx` | Took main | Same UX-label class as `money.ts`. |
| `apps/ios/.gitignore` | Took main | Main's pattern is more nuanced — it tracks the workspace-level `Package.resolved` (required for Xcode Cloud SPM resolution) while still ignoring SPM build-artifact copies under `SourcePackages/checkouts/**`. Feature branch's version would have un-ignored too much. |
| `.github/workflows/test.yml` | Took main | Main's CI sets up both Bun and Node (vitest needs Node); feature branch's version omitted Node setup. Main also drops the now-stale "lint not gated yet" comment. The whole feature commit `195ba6c` became a no-op after this resolution. |

**Two source commits silently dropped by the rebase as no-ops** (work already on main):

- `195ba6c` "ci: switch test workflow to Bun + monorepo" — superseded by main's CI work
- `baba085` "Track Package.resolved for Xcode Cloud SPM resolution" — main commit `509977a` (PR #24) already added Package.resolved tracking

The merge commit `994c78f` was also dropped, as expected for a non-`--rebase-merges` rebase.
