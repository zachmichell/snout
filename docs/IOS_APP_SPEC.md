# Snout iOS App Spec

Authoritative handoff document for the Xcode build of the Snout pet-parent iOS app. This document describes what to build, what the existing backend already provides, and the boundaries between the iOS layer and the rest of the system.

The intended reader is a Claude Code session running inside the `apps/ios/` directory of this monorepo with read access to the entire repo. That reader has the React/Supabase code as ground truth and uses this document to map iOS responsibilities onto it.

---

## 1. Scope

The iOS app is the **client-side** experience only. It is the pet parent's view of Snout. It deliberately does not implement any staff workflow.

The five things v1 does well:

1. Sign in and view reservations with live status (requested, confirmed, checked-in, checked-out).
2. View report cards and photos for past visits, including download with meaningful filenames.
3. Receive push notifications for report cards, photos, booking confirmations, payment receipts.
4. Watch live cameras for the facility a pet is currently visiting.
5. Message the facility through the existing conversations subsystem.

Out of scope for v1:

- Booking new visits (deferred to v2; the wizard exists on web and works fine there).
- Paying invoices (deferred to v3; payment links open Safari today).
- Any staff-side functionality (POS, check-in, scheduling, invoicing). The web app remains the staff surface.

---

## 2. Architecture

### Backend

The iOS app uses the **same Supabase backend** as the web app. There is no separate API tier. All data access goes through:

- **Supabase Auth** for sign-in and session management.
- **PostgREST** (via the Supabase Swift SDK) for table reads and writes; RLS policies are the same as the web app's, so any read the web app can do, the iOS app can do.
- **Supabase Realtime** for live status changes (reservations, messages).
- **Supabase Storage** for photos and documents, including signed URL generation.
- **Edge Functions** for anything that requires elevated privilege or third-party API calls (push registration, payment links, etc.).

The Supabase project ID is `empdnuzfjgfnphwauhah`. The base URL is `https://empdnuzfjgfnphwauhah.supabase.co`. The publishable (anon) key is the same one the React app uses; expose it via `Info.plist` or a Swift constant.

### Recommended Swift dependencies

- `supabase-swift` (https://github.com/supabase-community/supabase-swift) for Auth, PostgREST, Realtime, Storage, Functions invocation.
- `AVKit` (system framework) for HLS playback. iOS handles HLS natively; no third-party player needed.
- `WebKit` (system framework) for iframe-style webcam embeds.
- Apple's `UserNotifications` and `UIKit` push registration APIs for APNS, with FCM as the fan-out target on the server side (see Section 7).

Avoid pulling in heavy SDKs that duplicate what Supabase already provides. Avoid React Native, Capacitor, or any web-shell approach; the audit was explicit that the native experience is the wedge.

### Authoritative source of truth

The Supabase database schema is the source of truth for both web and iOS. The TypeScript types in `apps/web/src/integrations/supabase/types.ts` are auto-generated from the schema; the equivalent for Swift is the `supabase-swift` SDK plus hand-written model structs that mirror the Postgres tables you read.

When the schema changes (a migration lands), both apps' types update from the same generator: the web app via `supabase gen types typescript`, the iOS app via either hand-edits (small set of tables) or `supabase gen types swift` once that's stable.

---

## 3. Auth

### Sign-in methods

The web app supports password sign-in and magic links via `supabase.auth.signInWithPassword` and `supabase.auth.signInWithOtp`. The iOS app should expose the same plus **Sign in with Apple** (App Store requirement when offering third-party login).

### Sign in with Apple setup

1. Register the bundle id in Apple Developer.
2. Enable "Sign In with Apple" capability in Xcode for the target.
3. In the Supabase dashboard, configure the Apple provider with the Services ID, Team ID, Key ID, and the .p8 private key.
4. In Swift, use `ASAuthorizationAppleIDProvider` and pass the resulting nonce + identity token to `supabase.auth.signInWithIdToken(provider: .apple, idToken: ...)`.

### Session persistence

`supabase-swift` writes the session to the iOS Keychain by default. Sessions survive app restarts, OS reboots, and device migrations. Refresh tokens rotate automatically. Do not implement a custom session store.

### After sign-in: membership resolution

The user's organization membership is in `memberships` (profile_id, organization_id, role, active). Pet parents have `role = 'customer'` in a single org. The iOS app should query their active membership at launch and treat that org as the implicit context for every subsequent read.

```swift
let membership = try await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("profile_id", value: userId)
    .eq("active", value: true)
    .single()
    .execute()
    .value as Membership
```

---

## 4. Feature mapping

For each feature, the table below names the relevant database tables, edge functions if any, and the React component you should read to understand current behavior.

### 4.1 Reservations

| Need | Where |
|---|---|
| List reservations | `reservations` table, filtered by `primary_owner_id` |
| Live status updates | Supabase Realtime subscription on `reservations` |
| Reservation detail | Same table; join `services`, `locations`, `reservation_pets`, `pets` |
| Status badge styling | `apps/web/src/components/portal/ReservationStatusBadge.tsx` |
| Reference React surface | `apps/web/src/pages/portal-owner/Bookings.tsx` |

The client-side filter uses `primary_owner_id` (not `owner_id`, which does not exist on this table — see section 11).

### 4.2 Report cards and photos

| Need | Where |
|---|---|
| List report cards | `report_cards`, filtered via `useOwnerReportCards` hook |
| Detail view | `apps/web/src/pages/portal-owner/ReportCardDetail.tsx` |
| Photo storage | `report-card-photos` Storage bucket; paths in `report_cards.photo_urls[]` |
| Signed URLs | `supabase.storage.from("report-card-photos").createSignedUrls(paths, 3600)` |
| Forced download with filename | Append `?download=<filename>` to the signed URL — see `apps/web/src/lib/storage-download.ts` |

The web app builds filenames as `<pet>-<YYYY-MM-DD>-photo-<idx>.<ext>`. Mirror this convention in Swift.

For the iOS share sheet, use `UIActivityViewController` with the local file URL after downloading via `URLSession`. The download attribute trick the web uses is not needed; `UIActivityViewController` always saves with the filename you provide.

### 4.3 Push notifications

See Section 7. Different protocol from web (APNS, not Web Push); same notification taxonomy.

### 4.4 Live cameras

| Need | Where |
|---|---|
| List cameras | `webcams` table, filtered by org and active reservation locations |
| Player kinds | `source_kind` enum: `hls` / `mp4` / `iframe` |
| Reference React | `apps/web/src/components/portal/WebcamPlayer.tsx`, `apps/web/src/pages/portal-owner/Webcams.tsx` |
| iOS player | `AVPlayerViewController` for hls/mp4; `WKWebView` for iframe |

The owner-side filter logic: only show a camera if it has no `location_id` (org-wide) OR the user has an active reservation (`status` in `confirmed`, `checked_in`) at that location. Mirror exactly.

### 4.5 Messaging

| Need | Where |
|---|---|
| Conversations | `conversations` table (one per owner-org pair) |
| Messages | `messages` table |
| Hooks | `apps/web/src/hooks/useConversations.ts`, `apps/web/src/hooks/useMessages.ts` |
| Realtime | Subscribe to `messages` channel filtered by `conversation_id` |
| Send | Insert into `messages` (RLS verifies sender is in the conversation) |

The unread count is computed from `messages.read_at IS NULL AND sender_role != 'owner'`. Mirror.

### 4.6 Pet detail and vaccinations

| Need | Where |
|---|---|
| Pet list | `pets` joined via `pet_owners` |
| Vaccination records | `vaccinations` table |
| Reference React | `apps/web/src/pages/portal-owner/PetDetail.tsx` |
| Vaccination doc download | `vaccination-docs` bucket; same `?download=<filename>` pattern |

---

## 5. iOS-specific UX patterns

The audit's mobile-specific complaints, addressed at the iOS layer:

- **Auto-logout / session loss.** Use `supabase-swift`'s default Keychain session store. Do not roll your own token refresh.
- **Keyboard re-render and focus jumping.** Use SwiftUI form fields with `.textContentType` (e.g. `.emailAddress`, `.familyName`, `.streetAddressLine1`) and `.keyboardType` modifiers (`.emailAddress`, `.phonePad`, `.numberPad`). The autocomplete attributes on the web side in `apps/web/src/pages/auth/Login.tsx` and `apps/web/src/pages/onboarding/Onboarding.tsx` map one-to-one to SwiftUI's `.textContentType` values.
- **Pinch zoom on photos.** Use `MagnificationGesture` on a SwiftUI `Image` inside a `ScrollView`. There are reference implementations on GitHub; pick one and ship.
- **App backgrounding losing form data.** Use `@SceneStorage` for in-progress form state.
- **Photo and video download.** Use `UIActivityViewController` with the local file URL. The user gets the standard share sheet with "Save to Photos" as one option.
- **Live Activity / lock-screen widget.** When a pet is checked in, surface "Bear is at Sunny Paws Daycare" with the live webcam thumbnail. This requires ActivityKit and a `ActivityAttributes` definition. The Realtime subscription on `reservations` drives the activity state.

### Brand and design

The web app's design tokens live in `tailwind.config.ts` and `apps/web/src/index.css`. The colors, font (Forma DJR for display, Inter for body), and rounded-corner conventions should map to iOS as:

- Display font: load Forma DJR via `Info.plist` `UIAppFonts`, or fall back to SF Pro Display for v1 and add the custom font in v1.1.
- Body font: SF Pro is fine.
- Accent color: pull the hex value from `tailwind.config.ts` `colors.accent.DEFAULT` and use it as `Color("AccentColor")` in `Assets.xcassets`.
- Corner radii: 8px on cards, 16px on tiles, 20px on hero sections — matches the web `rounded-lg` / `rounded-xl` / `rounded-2xl` set.

---

## 6. RLS and what the iOS app can read

Row-level security is the same on iOS as on web. Pet parents have access through three policies, in rough order of frequency:

1. `is_org_member(organization_id)` — for org-scoped reads (e.g. `webcams`, `services`).
2. `auth.uid() = profile_id` — for self-only rows (e.g. `push_subscriptions`, `changelog_reads`).
3. Owner relationship via `owners.profile_id = auth.uid()` plus joined-table policies — for pet, reservation, invoice, report card reads.

**Do not call SQL functions from the client that are gated to `service_role`.** The owner-callable RPC surface is the table policies plus a small set of functions (`consume_credits`, `try_apply_credit_adjustment`, etc.) that explicitly grant EXECUTE to the `authenticated` role. If a function isn't granted, calling it returns 42501 / permission denied; route through an edge function instead.

---

## 7. Push notifications (APNS via FCM)

### Why FCM

The web app uses Web Push with VAPID. iOS uses APNS, which is a different protocol with different keys. Rather than maintain two separate sender paths in the backend, register iOS device tokens with **Firebase Cloud Messaging**, which bridges to APNS automatically. The backend's `send-push-notification` edge function then makes a single FCM request that fans out to both web (Web Push) and iOS (APNS) subscribers for the same user.

### Server-side changes (not yet built)

To wire FCM in, the following must land before push works on iOS:

1. New table `device_tokens` (parallel to `push_subscriptions`): `profile_id`, `fcm_token`, `platform` ('ios' / 'android'), `created_at`, `last_seen_at`, `deleted_at`.
2. Update `send-push-notification` to take a `profile_id`, query both `push_subscriptions` (web) and `device_tokens` (mobile), and fan out via FCM's HTTP v1 API. FCM auto-routes mobile tokens to APNS without us managing certs.
3. New edge function `register-device-token` for the iOS app to call on launch + token rotation.

This is the smallest amount of server work and is its own batch. Note that until that batch lands, the iOS app can still register tokens but pushes won't actually deliver.

### iOS-side responsibilities

1. Request notification permission on first launch (use `UNUserNotificationCenter.requestAuthorization`).
2. On permission grant, register for remote notifications via `UIApplication.shared.registerForRemoteNotifications()`.
3. Implement `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` to receive the APNS device token.
4. Pass the APNS token to Firebase via `Messaging.messaging().apnsToken = ...`.
5. Implement `MessagingDelegate.messaging(_:didReceiveRegistrationToken:)` to receive the FCM token.
6. POST the FCM token to `register-device-token` edge function with the user's bearer token.
7. Implement `UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:)` to handle notification taps. The payload's `url` field tells you what screen to navigate to (use SwiftUI's `NavigationStack` programmatic path or your router of choice).

### Notification payload contract

The web service worker reads four fields from the push payload: `title`, `body`, `url`, `tag`. The iOS app should expect the same fields in `userInfo`. Whichever sender is invoked — Web Push or FCM — the JSON shape is the same.

---

## 8. Code reuse with the web app

### What is shared automatically

1. **Database schema and types.** Postgres is the single source of truth.
2. **Edge functions.** Pure server-side, both clients call them identically.
3. **RLS policies.** Same authorization for both.
4. **Validation rules** that live in Postgres (CHECK constraints, triggers, functions). Both clients see the same error.

### What is duplicated and how to keep it in sync

The web app has a small library of pure-logic helpers in `apps/web/src/lib/` that need Swift equivalents:

| TypeScript file | Swift port priority | Notes |
|---|---|---|
| `apps/web/src/lib/storage-download.ts` | High (used in 4.2 photo flows) | Trivial port |
| `apps/web/src/lib/format.ts` | High (date/age formatting) | iOS has DateFormatter; map directly |
| `apps/web/src/lib/care.ts` | Medium (rating/mood meta for report cards) | Static enums; pure data |
| `apps/web/src/lib/credits.ts` | Low | Owner doesn't see credit math directly in v1 |
| `apps/web/src/lib/booking.ts` | Low (only needed if v2 books from iOS) | Defer until booking lands |
| `apps/web/src/lib/surcharge.ts` | Low (defer until iOS pays) | Defer to v3 |
| `apps/web/src/lib/money.ts` | High | Cents math + currency formatting |

**Convention for new helpers.** When a new pure-logic helper is added on either side, the corresponding port is recorded in `docs/PARITY_LOG.md`. Both implementations should be covered by tests with the same inputs and outputs. The web tests live under `apps/web/src/lib/__tests__/`; the Swift tests should live under `apps/ios/SnoutTests/`.

See `docs/SHARED_LOGIC.md` for the full convention.

### What is intentionally NOT shared

1. UI components. SwiftUI and React are different. Don't try to bridge.
2. Routing. iOS uses `NavigationStack`; web uses React Router.
3. State management. iOS uses ObservableObject / @Observable; web uses TanStack Query. Different paradigms; map cleanly to the same backend.
4. Forms. iOS uses SwiftUI Form; web uses shadcn/ui. Different input components, same data shape.

---

## 9. Repo layout for the Xcode project

The iOS project should live in `apps/ios/` at the monorepo root. Recommended structure:

```
ios/
  README.md                  # Setup notes for opening the project
  Snout.xcodeproj/           # The Xcode project file
  Snout/                     # App target sources
    SnoutApp.swift           # Main app entrypoint
    Models/                  # Swift structs mirroring Postgres tables
    Views/                   # SwiftUI views, organized by feature
    Services/                # Supabase clients, push handlers, etc.
    Utilities/               # Ports of apps/web/src/lib/* helpers
    Resources/               # Assets, Info.plist, config
  SnoutTests/                # Unit tests
  SnoutUITests/              # UI tests
```

The `apps/ios/` directory is `.gitignore`-friendly for transient build outputs (`build/`, `*.xcworkspace/xcuserdata/`, `DerivedData/`) but tracks the project file, sources, tests, and assets.

A Claude Code session running with cwd `/Users/zachmichell/snout` (the repo root) can read both the React/Supabase code and the Swift code, which is exactly the cross-app awareness you want.

A Claude Code session running with cwd `/Users/zachmichell/snout` can read both directions equally well across `apps/web/` and `apps/ios/`. Relative paths from `apps/ios/` upward (`../web/src/lib/storage-download.ts`) are accessible if needed.

---

## 10. Testing requirements

Each pure-logic helper that gets ported to Swift must have:

1. A Swift unit test in `SnoutTests/` covering the same input/output pairs as the TypeScript test.
2. The TypeScript test file referenced as a comment at the top of the Swift test, so a future reader can verify parity by reading both.

Example header for `SnoutTests/StorageDownloadTests.swift`:

```swift
// Parity contract: apps/web/src/lib/__tests__/storage-download.test.ts
// Both implementations must satisfy the same inputs and outputs.
```

The web side does not yet have a `storage-download.test.ts`; that's a parity test that should be added on the next batch alongside the Swift port.

---

## 11. Schema gotchas

A few things in the database that are easy to miss without context:

- **`reservations` foreign keys for the owner are `primary_owner_id`** (not `owner_id`). Use that everywhere.
- **`pet_owners` is the join table** between pets and owners; multiple owners can co-own a pet. The pet parent's pets are reached via `pet_owners.owner_id = your_owner_id` then join to `pets.id`.
- **`profiles` and `owners` are separate**. `profiles.id` is `auth.users.id`; `owners` is per-organization, with `owners.profile_id` linking back. A single user can be an owner at multiple organizations (rare today but supported).
- **Soft deletes everywhere.** Almost every table has `deleted_at`. RLS does NOT automatically filter out soft-deleted rows; client queries must `.is("deleted_at", null)` explicitly. Skipping this filter is the #1 bug source on the web side.
- **Currency is per-organization**, fixed at signup. Don't ask the user to choose currency at the iOS layer.

---

## 12. Out-of-scope for v1, on roadmap

These are deferred but worth knowing about so v1 doesn't paint into a corner:

- **Booking from iOS.** The web booking wizard is in `apps/web/src/components/portal-owner/booking-wizard/`. When v2 picks this up, Swift implements an equivalent four-step flow against the same `reservations` table.
- **Paying invoices from iOS.** Today payment links open Safari. v3 should embed Stripe iOS SDK or Helcim's iOS SDK depending on the org's processor. The `useCreateCheckoutSession` hook on web is the model; the iOS equivalent calls the same edge functions.
- **In-app webcam fullscreen with rotation lock.** AVPlayerViewController handles fullscreen; rotation lock requires overriding `UIViewController.supportedInterfaceOrientations` only for the camera screen.
- **Apple Wallet integration.** A vaccination record could be exposed as a Wallet pass. Not in scope; mentioned only because the data model already has the records.

---

## 13. Open questions for the iOS engagement

These should be resolved early in the iOS build, not assumed:

1. **Minimum iOS version.** Recommend iOS 17.0 to match Swift Concurrency baseline and SceneStorage maturity. Drops to ~95% of active iOS devices as of late 2025.
2. **TestFlight distribution.** Set this up before writing any feature so beta builds land naturally.
3. **App Store review.** Sign in with Apple is required when using third-party login; have it working before submission.
4. **Crash and analytics.** Sentry's Cocoa SDK or Firebase Crashlytics. Pick one and wire it in early.
5. **Brand assets.** App icon, launch screen, accent color. Pull from the web design tokens; commission an iOS-grade icon if the existing one isn't square enough.

---

## 14. Reading order for a fresh Claude Code session in `apps/ios/`

If I were a new Claude Code session walking into this directory cold, this is the reading order I would follow:

1. This file.
2. `docs/SHARED_LOGIC.md`.
3. `docs/PARITY_LOG.md` (to see what's already been ported and what hasn't).
4. `apps/web/src/integrations/supabase/types.ts` (skim for relevant tables).
5. `apps/web/src/hooks/useAuth.ts` (auth flow).
6. The web component listed in Section 4 for whatever feature you're implementing.
7. The corresponding TypeScript helper in `apps/web/src/lib/` if any.

That order takes about 30 minutes and produces enough context to start writing Swift confidently.
