# Snout Implementation Roadmap — MoeGo Competitive Analysis Reconciled to Codebase Reality

> Planning doc. The competitive analysis (`Snout_vs_MoeGo_Competitive_Analysis.docx`, June 17 2026) proposed 24 features across 3 waves and flagged most as gaps. A full codebase audit (10 parallel feature-cluster audits + 7 implementation designs, 444 tool calls across migrations, edge functions, web, and both iOS apps) shows **the analysis was substantially wrong about what already exists.** This roadmap corrects the record and re-scopes the build accordingly.

---

## 1. TL;DR

- **The "gaps" are mostly already built.** Of the 6 P0 features the competitive doc called missing, **none is a true greenfield build.** Report cards, two-way messaging, care logging + schedules + incidents + playgroups, occupancy/capacity enforcement, recurring appointments, and vaccine records are all shipped end-to-end. The real P0 work is **finishing edges**, not building features.
- **Across all 24 items, the doc was wrong far more than it was right.** At least **13 items** were rated worse than reality (memberships/packages, multi-location, camera, KPI/reports, bookkeeping, recurring appointments, multi-pet ticket — all called partial/gap but actually shipped). A handful were rated *too generously* and we correct them **down** (multi-pet discounts, evaluations, vaccine gating/alerts).
- **The genuine money-movement gaps are concentrated in one cluster.** Deposits, no-show charges, and charging cards-on-file are real holes: the schema and tokenization exist, but **no code path ever charges a stored card off-session.** That single missing primitive (`charge-saved-card`) unlocks deposits + no-show fees together.
- **The proactive/automation layer is the other consistent gap.** Reminders are single-touch SMS only; vaccine expiry alerts, review-booster, marketing send pipeline, and journey/drip automation are absent or stubbed — but the cron + edge + vault + multi-channel dispatch infra (`invoke_*` + `send-sms`/`send-email`/`send-push-notification`) is mature and reusable. These are wiring jobs, not platform jobs.
- **The leapfrog is cheap because the foundation is solid.** DB-enforced double-booking prevention already exists; an AI-native **per-tenant learned no-show model + gap-fill + smart waitlist** layers on top as honest ML (logistic regression, nightly retrain, surfaced AUC/Brier) and compounds with the deposit work.
- **Net: this is a "finish and differentiate" plan, not a "catch up" plan.** Snout is at or above MoeGo basic parity on most operational surfaces today. The roadmap front-loads the few real revenue-protection holes, then the proactive automation layer, then the AI differentiator.

---

## 2. Corrected Status Table (all 24 items)

Legend: ✅ already built (doc wrong) · 🟡 partial · ⬜ true gap · ⬇️ corrected **down** from doc

### P0 — Wave 1

| # | Feature | Doc said | ACTUAL | What's really left | Effort |
|---|---------|----------|--------|--------------------|--------|
| 1 | Report cards (photos + notes) | Gap | ✅ Have | **Video only** — add `video_urls`, signed-upload edge fn, players. Photos/templates/owner render all shipped (`report_cards`, `ReportCardEditor.tsx`, iOS). | M |
| 2 | Two-way messaging | Gap | ✅ Have | Two edges: **staff/web attachment sending** + **staff→owner native push**. Core 1:1/broadcast/unread/realtime all live (`conversations`/`messages`, `broadcast_class_message`). | M |
| 3 | Reminders + no-show (deposits/cards) | Have/Partial | 🟡 Partial | Reminders are **single SMS touch**; deposits/no-show are a **manual ledger with no money movement**; saved cards **never charged**. Keystone: `charge-saved-card`. | L |
| 4 | Care-task engine | Gap | 🟡 Partial | Care **logging** + feeding/med schedules + incidents + playgroups all shipped. Missing: **auto-generated, dated, assignable, completable tasks** (`care_tasks` + generator). | L |
| 5 | Lodging/occupancy + capacity | Partial | ✅ Have (+1 hole) | Suite grid + DB oversell triggers shipped. Gaps: **service/area daily headcount cap not enforced** (`capacity_settings` dead) + occupancy view is suite-only. | M |
| 6 | Vaccine alerts | Partial | 🟡 Partial ⬇️ | Records strong. **No proactive expiry alerts, no hard gating, no iOS UI, required set hardcoded.** (doc over-rated gating/alerts → corrected down to Gap.) | M |

### P1 — Wave 2

| # | Feature | Doc said | ACTUAL | What's really left | Effort |
|---|---------|----------|--------|--------------------|--------|
| 7 | Smart/AI scheduling | Gap | 🟡 Partial | Double-booking prevention DB-enforced. **No AI/gap-fill optimizer** — the leapfrog (see §5). | XL→L |
| 8 | Memberships/packages | Gap | ✅ **Have** | Fully shipped: ledger, Stripe purchase, expiry cron, RPCs. **One fix:** package credits skip `credit_ledger` (drift). No recurring auto-rebill. | M |
| 9 | Review booster | Gap | ⬜ Gap | Entire feature: post-visit trigger + review link + throttle + template. | L |
| 10 | Online booking depth | Partial | 🟡 Partial | Auth owner booking works. **Branding/rules unwired, no public/embed page, no Reserve-with-Google, `leads` has no UI.** | L |
| 11 | Multi-service/multi-pet ticket | Partial | ✅ Have | Multi-pet native; multi-service via add-ons. Polish: **add-ons in the booking wizard**, single multi-line ticket UX. | M |
| 12 | Evaluations / meet-greet | Partial | ⬜ Gap ⬇️ | **No eval object at all.** Corrected down — needs a dedicated type + outcome workflow + booking gate. | L |
| 13 | Payroll/commissions/timeclock | Gap | ⬜ Gap | `commission_rate_percent` is decorative; "clock in/out" is a PIN switcher. Real punches + commission engine needed. | XL |
| 14 | KPI dashboard + reports | Partial | ✅ **Have** | Report builder + ~20 reports + 5 analytics tabs + QBO depth all shipped. Polish: click-through drill-down, scheduled reports. | S |

### P2 — Wave 3

| # | Feature | Doc said | ACTUAL | What's really left | Effort |
|---|---------|----------|--------|--------------------|--------|
| 15 | Marketing campaigns + workflows | Gap | 🟡 Partial | `email_campaigns` + CRUD page exist but **"Send" doesn't send**; no SMS campaigns; page orphaned in nav. Journey: birthday + reminder crons only. | M |
| 16 | Leads / CRM pipeline | Gap | ⬜ Gap | Table + portal config only. **Zero UI/conversion/follow-up.** | L |
| 17 | POS / tap-to-pay | Gap | 🟡 Partial | Software POS shipped; card-present is a stub. Needs **Stripe Terminal / Tap to Pay on iPhone**. | L |
| 18 | Overdue + bulk collection | Gap | 🟡 Partial | Overdue **display** exists; **no AR aging, no bulk reminders, no batch charge** (unlocked by `charge-saved-card`). | M |
| 19 | Camera / live-cam | Gap | ✅ **Have** | Fully shipped web + iOS (`webcams`, `WebcamPlayer.tsx`). At/above parity. BYO-feed by design. | none |
| 20 | Bookkeeping / accounting | Partial | ✅ **Have** | Deep QBO double-entry sync (12 fns, tips/credits/payout splits). Only native in-app GL is beyond. | M |
| 21 | Multi-location command center | Partial | ✅ **Have** | Within-org multi-location fully wired (`LocationContext`, scoped analytics/reports). True cross-*org* is the gap. | M |
| 22 | Managed Ads | Gap | ⬜ Gap | Entirely unbuilt. | XL |
| 23 | Android client | Gap | ⬜ Gap | Placeholder README only. Backend reuse high; client greenfield + FCM. | XL |
| 24 | Security attestations (SOC2/PCI) | Gap | ⬜ Gap | Strong de-facto hygiene (RLS everywhere, Vault, hashed PINs). No certifications — audit program, not code. | XL |

---

## 3. Revised P0 (Wave 1) Plan

Three of six P0s are **finish-the-edges** jobs (1, 2, 5). One is mostly-built-but-needs-a-real-layer (4). Two carry genuine net-new work (3, 6) — and the net-new in #3 is the highest-leverage code in the whole roadmap.

### P0-1 · Report cards — close the video gap (M) — *nearly done*
**Baseline:** Fully shipped end-to-end (DB+RLS, web staff/owner, both iOS apps, templates, signed URLs, publish→email). Only genuine gap: **video** (everything is `image/*`).
**Build:** Treat video as another media kind in the same private bucket — reuse the path-keyed storage policies (media-agnostic) and on-demand signed URLs verbatim.
- **PR1 (DB):** `ALTER report_cards ADD video_urls text[] DEFAULT '{}'`; optionally cap bucket `file_size_limit` + mime allowlist; regen types. Inert.
- **PR2 (edge):** `generate-report-card-upload-url` — `is_org_staff` auth + server-side size/type/count caps → `createSignedUploadUrl`. Clients PUT bytes directly (no base64 through edge).
- **PR3–4 (web):** video section in `ReportCardEditor.tsx`; `<video controls>` gallery in owner `ReportCardDetail.tsx`.
- **PR5–6 (iOS):** `ReportCard.swift` `video_urls`; AVKit `VideoPlayer` in carousel/lightbox (client); staff editor `.videos` picker + `AVAssetExportSession` H.264 transcode → signed upload (staff).
- **PR7:** email stays photo-only (poster-still or text fallback — never embed video).
**Risk:** server-side size cap is the control point (client-only is insufficient — the deposits lesson). Transcode HEVC→H.264 for cross-platform `<video>`.
**Lives in:** `report_cards`, `report-card-photos` bucket, `supabase/functions/generate-report-card-upload-url`, `apps/web/.../ReportCardEditor.tsx` + `portal-owner/ReportCardDetail.tsx`, `apps/ios/{Snout,SnoutStaff}/...ReportCard*`.

### P0-2 · Two-way messaging — close two edges (M) — *nearly done*
**Baseline:** ~90% built and must not be rebuilt (tables+RLS, realtime, unread counters, broadcast, attachment *rendering* everywhere, iOS-owner attachment *sending*, owner→staff APNs).
**Build (scope = 2 gaps + 1 fix):**
- **GAP 1 — attachment SENDING from web staff + staff iOS.** No DB/RLS work (`messages.attachments` + `message-attachments` bucket + 4 policies live). Web `MessageComposer.tsx` gets a file input; **`useSendMessage.ts` must stop hard-coding `attachments: null`.** Staff iOS mirrors the proven owner `ConversationView.swift` upload — lift it into a shared helper so the two apps don't diverge.
- **GAP 2 — staff→owner native push (bigger than the audit said).** Owner `PushService.swift` is a **stub that never persists its APNs token**, and the only owner-push path is Web Push (browser), not the phone. Fix: (a) port `StaffPushService` registration into the owner app (`device_tokens`, `app='client'`); (b) DB trigger branch for `sender_type='staff'` → new `send_owner_push` dispatcher; (c) new `send-owner-push` edge fn (extract `_shared/apns.ts` from `send-staff-push`; **must set the client bundle id `org.snoutapp.snout`** or it 400s BadTopic).
- **FIX:** add the deferred `mark_conversation_read_by_staff` RPC (symmetric, atomic).
- **PR order:** DB push migration → `_shared/apns.ts` + `send-owner-push` → owner PushService real registration → web attachments → staff iOS attachments → read-marking cleanup → TestFlight redistribute.
**Risk:** verify owner-side web uploads satisfy the `is_org_member(foldername[1])` storage policy (owners aren't org members); iOS owner already sends, so confirm that path before assuming web-owner upload works. Dedupe Web-Push vs new APNs to avoid double-push.

### P0-3 · Reminders + no-show protection (deposits / cards) (L) — *net-new core*
**Baseline:** Schema + tokenization exist; **no money moves.** `computeDepositCents()` is never called; deposit buttons only flip a status string; **no off-session charge of a saved card exists anywhere.** Reminders = one SMS touch.
**Build — three independently shippable tracks on the one keystone primitive:**
- **Track 1 — multi-touch / multi-channel reminders (M):** generalize `send-reservation-reminders` to iterate configurable offsets (7d/24h/2h), branch channel on `communication_preference` (SMS/email via `send-email`/push via `dispatch-owner-push`), dedupe via new `reminder_log`; add a short-lead pg_cron. Pure value, no payments.
- **Keystone — `charge-saved-card` edge fn (M):** off-session PaymentIntent on the connected account against stored `stripe_payment_method_id`/`stripe_customer_id`. **This one function unlocks deposits, no-show fees, and bulk collection (#18).** Land and test in isolation against a test connected account.
- **Track 2 — real deposit collection (L):** call `computeDepositCents()` at booking, INSERT a `deposits` row, collect via hosted checkout (owner) or `charge-saved-card` (staff); `apply_deposit_collected` RPC; net deposit against the final invoice; refund via existing `stripe-refund-payment`.
- **Track 3 — no-show / late-cancel fee (M):** `no_show_policy` table; hook a **manager-gated confirm dialog** into the existing `useCheckInOut` no_show flip and owner late-cancel; `record_no_show_charge` RPC + activity log.
**Risk:** off-session charges hit `requires_action`/declines constantly — handle non-success (notify staff, retry, send payment link). Idempotency keys on `deposit_id`/`reservation_id+purpose`. Never silently auto-charge without an audit row. Scope v1 to Stripe (Helcim lacks symmetric off-session).
**Lives in:** `supabase/functions/charge-saved-card`, `deposits`/`deposit_settings`/`no_show_policy`, `lib/deposits.ts`, `Deposits.tsx`/`DepositsTab.tsx`, `useCheckInOut.ts`.

### P0-4 · Care-task engine (L) — *build the missing layer on top of shipped primitives*
**Baseline:** A complete care-**logging** engine + feeding/med schedules + incidents + playgroups are all shipped. Missing: nothing **auto-generates dated, assignable, completable tasks**. (Ignore the orphaned `checklist_*` tables.)
**Build:** Layer on top — don't replace `pet_care_logs`.
- `care_task_templates` (per-org expected slots) + `care_tasks` (materialized, dated, `assigned_to`, `status`, `due_at`, `care_log_id` back-link).
- Generation: `generate_care_tasks_for_reservation()` RPC at check-in **plus** a daily `generate-care-tasks` cron (catches multi-night boarders). Strict idempotency via partial UNIQUE index + `ON CONFLICT DO NOTHING`.
- Completion: `complete_care_task()` flips status **and writes a `pet_care_logs` row** — so report-card summaries + owner timeline light up for free.
- Web "Care board" (Tasks tab on `/care-logs`); iOS staff "EXPECTED CARE" checklist on the visit screen. **No owner iOS change** (owners see completion via existing care-log-after-publish path).
**Risk:** feeding/med `frequency`/`timing` are free-text and **empty in prod** — do **not** build a parser; default to org template slots + optional additive `time_of_day[]`. Use `is_org_staff` (not `is_org_member`) on `care_tasks` to avoid the RLS-leak class.

### P0-5 · Lodging/occupancy + capacity rules (M) — *mostly done; one real hole*
**Baseline:** Suite occupancy grid + per-unit capacity + **DB-enforced, race-safe oversell triggers** all shipped. **The P0 hole:** service/area **daily headcount caps are not enforced** — `capacity_settings` is dead scaffolding and `check_booking_conflict` has zero callers. A daycare day with no `suite_id` has no cap.
**Build — two tracks, reusing the suite-trigger pattern:**
- **Track A (real P0):** `enforce_service_daily_capacity()` BEFORE INSERT/UPDATE trigger — sibling of `enforce_suite_capacity`, `FOR UPDATE` on the `capacity_settings` row for race-safety, weekend/weekday cap + buffer, **NULL cap = unlimited (ships dark/inert)**. Upgrade `check_booking_conflict` to be capacity-aware and **finally wire it** into `StepDateTime.tsx` + `ReservationForm.tsx`. Add `CapacityTab` settings UI; map the `23514` error in `db-errors.ts`. **Must exclude add-on child reservations from the count.**
- **Track B:** generalize the suite grid into a resource-type tab switcher (Runs / Daycare / Self-Wash / All-resources rollup); read-only occupancy strip on iOS staff.
**Risk:** timezone "same day" bucketing (use location TZ, UTC fallback v1). Dark-ship Track A first — all-NULL caps = no behavior change.

### P0-6 · Vaccine tracking + proactive alerts (M) — *records done; four real gaps*
**Baseline:** Records layer strong (table, RLS, docs bucket, web CRUD, badges, CSV import). **Four gaps:** (1) no proactive expiry alerts; (2) no hard gating (`require_vaccinations` dead config); (3) iOS client has zero vax UI; (4) required set hardcoded.
**Build (reuse cron/vault/pg_net + `send-email`/`send-sms`/`send-push-notification` verbatim):**
- **PR2 is the headline win:** `send-vaccine-reminders` edge fn + `invoke_send_vaccine_reminders` wrapper + daily cron (clone the birthday-email pattern); multi-channel per `communication_preference` + staff digest; **dedupe via new `vaccine_reminder_log`** (push has no log, so this is required).
- **Configurability:** per-org `vaccine_settings` JSONB (lead days, channels, required set); refactor `checkin.ts` to read it; Settings UI.
- **Soft then hard gating:** `assert_vaccinations_ok` RPC wired to check-in (manager-only override) + booking wizards; then `enforce_vaccination_gate` trigger with a staff-only `vax_override` column. **Ship enforcement opt-in** — `require_vaccinations` currently defaults true but is unenforced; flipping it on is behavior-changing.
- **iOS:** `Vaccination` model + read-only PetDetail section + booking-wizard warnings.
**Risk:** owner app must not be able to set `vax_override` (strip client-side). Default SMS channel off (cost/fatigue). Use `send-push-notification` (service-role), **not** `dispatch-owner-push` (needs a user JWT — a cron can't call it).

---

## 4. Wave 2 & Wave 3 (condensed) — lean on what's already shipped

**The recurring theme:** the doc planned to *build* several of these from scratch; the audit shows the platform already exists and the work is **wiring + UI**.

### Wave 2 (P1)
- **#8 Memberships/packages — ✅ already shipped.** Don't rebuild. **One real fix:** package-purchase credits bump the denormalized owner cache but skip `credit_ledger`, so FIFO consume + `expire-credits` don't see them (drift). Fix = write a `credit_ledger` purchase row in `handlePackagePurchaseCompleted`. Optional: a recurring auto-rebill engine (`next_billing_date` is set but nothing charges it). **Effort: M (fix) / L (rebill).**
- **#14 KPI/reports — ✅ already shipped.** Report builder + ~20 reports + QBO depth exceed MoeGo basic. Polish only: click-through drill-down (builder already has a `filters` array — surface the UI), scheduled/emailed reports. **Effort: S.**
- **#11 Multi-pet/multi-service ticket — ✅ shipped.** Add add-ons to the booking *wizards* (currently staff-dashboard-only). **Effort: M.**
- **#10 Online booking depth (🟡):** wire the existing `portal_settings.booking_rules`/branding (schema-only today) into a Settings editor + wizard enforcement; build a public/embeddable booking page; render the `leads` capture form. Reserve-with-Google is the only true greenfield piece. **Effort: L.**
- **#9 Review booster (⬜):** post-completed-visit cron/trigger → review-link (Google/Facebook) via `send-email`/`send-sms`, throttle + settings toggle. Reuse the reminder cron pattern. **Effort: L.**
- **#12 Evaluations/meet-greet (⬜, corrected down):** dedicated eval service-type/table + pass/fail outcome + booking-eligibility gate (block daycare/boarding until eval done). **Effort: L.**
- **#13 Payroll/commissions/timeclock (⬜):** genuinely unbuilt — `commission_rate_percent` is decorative, "clock in/out" is a PIN switcher with no punches. Needs a `punches` table, commission engine, earnings report. Lowest ROI per effort. **Effort: XL.**

### Wave 3 (P2)
- **#18 Overdue + bulk collection (🟡):** the **`charge-saved-card`** primitive from P0-3 unlocks batch charging; add an AR-aging report (reuse `lib/reports.ts`) + "remind all overdue" via the reminder infra. **Effort: M** (cheap once P0-3 lands).
- **#15 Marketing campaigns (🟡):** the page exists but **"Send" doesn't send** — wire `email_campaigns` → fan-out to `send-email` with `email_log` per-recipient; add real segment counting; add to nav. SMS campaigns + journey/drip builder are the bigger lifts. **Effort: M.**
- **#16 Leads/CRM (⬜):** schema + portal config exist; build the list/Kanban/detail + `convert_lead` RPC + public capture form. **Effort: L.**
- **#17 POS tap-to-pay (🟡):** software POS shipped; integrate Stripe Terminal / Tap to Pay on iPhone into the existing `PosCart` charge flow. **Effort: L.**
- **#20 Bookkeeping (✅):** QBO double-entry sync already deep — only a native in-app GL/P&L is beyond. **Effort: M (if pursued).**
- **#21 Multi-location (✅):** within-org command center shipped; true cross-*org* franchise roll-up is the gap (depends on multi-org membership). **Effort: M+.**
- **#19 Camera (✅), #22 Ads (⬜ XL), #23 Android (⬜ XL), #24 SOC2/PCI (⬜ XL):** camera is done; the rest are large/organizational and out of the near-term code path. SOC2/PCI is an audit *program*, not a code change — de-facto hygiene is already strong.

---

## 5. The Leapfrog: AI-Native Smart Scheduling (P1 / differentiator)

**Why it's defensible and cheap:** DB-enforced double-booking prevention already exists (GiST EXCLUDE constraints, capacity-aware triggers, `check_booking_conflict`, deterministic slot fns) — **don't rebuild it.** The leapfrog layers *intelligence* on top, and it compounds with the P0-3 deposit work (high-risk booking → prompt for a deposit at booking time).

This is **honest ML, not rules-in-a-trenchcoat:** a per-tenant **learned** model, retrained nightly, with surfaced AUC/Brier metrics.

**Three capabilities, each shippable alone:**
1. **No-show risk model.** Nightly `train-noshow-model` edge fn fits an L2-regularized **logistic regression in pure TS** (no GPU, no external ML dep — keeps it data-residency-clean) on each org's own terminated reservations. Features from existing signals: lead time, hour, DOW, recurring, owner prior no-show/cancel rate, deposit-on-file, days-since-last-visit, new-owner. Cold-start: shrinkage toward a seeded **global prior** so day-one orgs get sane scores ("starts smart, gets smarter"). Real-time `score_reservation_noshow()` materializes `reservations.noshow_risk`/`band` via an **exception-swallowing trigger** (scoring never blocks a booking).
2. **Gap-fill optimizer.** `suggest_gap_fill()` RPC reuses the existing slot-overlap math, computes idle gaps, and ranks fills (minimize idle minutes, prefer clean tiling, down-rank slots adjacent to high-risk bookings). Surfaced as one-tap actions on the staff Dashboard + iOS Schedule.
3. **Smart waitlist.** `waitlist_entries` (owner self-insertable from the wizard when no slot fits) gives gap-fill real demand to place; offers fan out via `send-sms`/`send-staff-push`.

**The pitch:** MoeGo's smart scheduling is largely rule/template based. Snout ships a **learned, per-tenant no-show probability** that drives deposit prompts, overbooking-aware gap-fill, and automated waitlist backfill — measurable and self-improving. Keep v1 explainable (logistic regression + greedy ranking), not a solver. **Effort: L** (foundation already done).

---

## 6. Premium-Edge Strategy

The five differentiators, pressed against what the code actually supports today:

1. **Native client app as default.** **Already real** — two shipped SwiftUI apps (owner + staff) on one Supabase backend, both on TestFlight. Press it by closing the remaining native-parity gaps: **owner APNs push (P0-2 exposed it's a stub)**, iOS vaccination UI (P0-6), and report-card video (P0-1). Every P0 deliberately ships iOS in scope — keep that discipline. The honest gap is **Android (#23)**; until then, lead with iOS depth, not breadth.
2. **AI-native scheduling & no-show prediction.** This is the **sharpest wedge** because it's both differentiated *and* cheap (the prevention layer is built). Ship §5 and make the **AUC/Brier metrics visible in analytics** — "our scheduling learns your no-shows" is a claim competitors can't make with rule engines. Tie it to deposits (P0-3) so the AI directly protects revenue.
3. **Canadian-built trust / data residency.** The pure-TS, self-hosted ML (no external inference service), Vault-stored secrets, comprehensive RLS, and BYO-storage philosophy (camera, report-card media) all reinforce a **"your data stays in your stack"** story. SOC2/PCI (#24) is the formal capstone — start the program early as a sales asset even though it's not code; the de-facto controls are already strong.
4. **One unified cross-vertical ticket.** Multi-pet is native; multi-service rides add-ons. Press it by bringing **add-ons into the booking wizards (#11)** and the **single multi-line ticket UX** — so boarding + grooming + daycare on one visit is first-class in self-booking, not just a staff dashboard action.
5. **Modern, opinionated UX.** The shipped report-card template builder, drag-drop occupancy grid, and care board set the bar. Keep the opinionated defaults: **dark-ship safe migrations** (capacity caps, vaccine enforcement all opt-in), one-tap staff actions (care completion, gap-fill, no-show charge), and consistent `SnoutTheme`/`snoutCard` components across both iOS apps.

---

## 7. Recommended Build Sequence

Corrected for what's already done. Each milestone is independently shippable and ordered by **leverage ÷ effort**.

### Milestone A — Revenue protection (highest leverage)
The one cluster with real money holes, sequenced around the keystone primitive.
1. **`charge-saved-card` edge fn** (P0-3 keystone) — test in isolation. *Unlocks deposits, no-show fees, AND bulk collection (#18).*
2. **Multi-channel + multi-touch reminders** (P0-3 Track 1) — pure value, no payments risk.
3. **Deposit collection + no-show/late-cancel fees** (P0-3 Tracks 2–3).
4. **Bulk overdue collection + AR aging (#18)** — cheap follow-on, reuses the keystone.

### Milestone B — Finish the near-done P0s (fast wins, high parity payoff)
5. **Report-card video (P0-1)** — column → edge fn → web/iOS players.
6. **Messaging edges (P0-2)** — attachment sending + staff→owner native push + read-marking fix.
7. **Service/area capacity enforcement (P0-5 Track A)** — dark-ship the trigger, then wire `check_booking_conflict` + `CapacityTab`. *Closes the one real oversell hole.*

### Milestone C — Proactive automation layer
8. **Vaccine proactive alerts (P0-6 PR1–2)** — headline cron win; then configurability + gating (opt-in).
9. **Care-task engine (P0-4)** — DB → generation/cron → web care board → iOS staff checklist.
10. **Lodging occupancy Track B (P0-5)** — multi-resource grid + iOS strip.

### Milestone D — The differentiator
11. **AI no-show model + scoring (§5 PR1–3)** — foundation, scoring trigger, nightly training.
12. **Risk surfacing + deposit prompt** (compounds with Milestone A).
13. **Smart waitlist + gap-fill optimizer.**

### Milestone E — Wave 2 polish & wiring (lean on shipped infra)
14. **Memberships credit-ledger fix (#8)** + **report drill-down/scheduling (#14)** — small, high-trust fixes to already-shipped features.
15. **Online booking depth (#10)** — branding/rules editor + public page + leads form.
16. **Review booster (#9)** + **marketing send pipeline (#15)** — reuse the reminder/cron infra.
17. **Evaluations/meet-greet (#12)**, **add-ons-in-wizard (#11)**.

### Later (large / organizational — deliberately deferred)
18. POS tap-to-pay (#17), Leads/CRM (#16), Payroll/commissions/timeclock (#13), cross-org franchise (#21), Android (#23), Managed Ads (#22), SOC2/PCI program (#24 — start as a parallel non-code track for sales).

**Bottom line:** Milestones A–C are the entire corrected P0, and they're dominated by *finishing and wiring*, not building. The single net-new primitive that matters most — `charge-saved-card` — is small and unlocks three separate roadmap items. Ship that first.

---

*Generated from a 10-cluster codebase audit + 7 implementation designs (18 agents, 444 tool calls). Source: `Snout_vs_MoeGo_Competitive_Analysis.docx` reconciled against the live repo + Supabase project `empdnuzfjgfnphwauhah` on 2026-06-17.*
