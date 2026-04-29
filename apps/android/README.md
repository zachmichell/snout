# Snout Android (placeholder)

Not yet scaffolded. This directory is reserved for the future Android client.

## When ready to build, recommended stack

- **Language:** Kotlin
- **UI:** Jetpack Compose (modern declarative UI, mirrors SwiftUI conceptually)
- **Backend SDK:** [supabase-kt](https://github.com/supabase-community/supabase-kt) — official community Supabase client for Kotlin (Auth, PostgREST, Realtime, Storage, Functions)
- **Build:** Gradle with Kotlin DSL
- **Min SDK:** 26 (Android 8.0) — covers ~95% of in-market devices
- **Target SDK:** latest stable

## Architectural conventions to mirror from iOS

The Android app should be the third client of the same Snout backend. It does **not** get its own database, edge functions, or auth tier. It calls the same Supabase project that the web and iOS apps call.

Mirror the iOS app's structure for consistency:

```
android/
├── app/
│   └── src/main/java/app/snout/
│       ├── SnoutApp.kt              # Application class
│       ├── models/                  # Data classes (mirror Swift Codable structs)
│       ├── services/
│       │   ├── SupabaseClient.kt
│       │   ├── AuthService.kt
│       │   └── PushService.kt       # FCM (already used by backend)
│       ├── ui/                      # Composables
│       │   ├── auth/
│       │   ├── home/
│       │   ├── reservations/
│       │   ├── reportcards/
│       │   ├── webcams/
│       │   ├── messages/
│       │   └── settings/
│       └── util/                    # Format, Money, StorageDownload — Kotlin ports
└── app/src/test/                    # Parity tests for any duplicated client logic
```

## Shared logic discipline

Same rule as iOS: see `docs/SHARED_LOGIC.md`. Postgres > edge function > duplicated client logic. Any helper duplicated across web/iOS/Android needs a parity log entry and matching tests on all three sides.

For Android, that means: when porting a TS or Swift helper, write a Kotlin test that covers the same input/output cases as the existing tests in `apps/web/src/lib/__tests__/` and `apps/ios/SnoutTests/`. Update `docs/PARITY_LOG.md`.

## Push notifications

The backend already speaks FCM (used as APNS bridge for iOS). Android push should be straightforward — register the FCM token via the existing `register-device-token` edge function pattern. No backend work needed beyond what already exists for iOS.

## Sign in with Google

Likely required for Android (parallel to Sign in with Apple on iOS). Configure in Supabase dashboard → Auth → Providers → Google. Use Credential Manager API on the Android side.

## When to actually start

Don't scaffold this prematurely. Start when one of:

1. A real Android user / customer asks for it
2. Snout's roadmap reaches the point where Android is needed for distribution parity (e.g., tenants with majority-Android customer bases)
3. iOS adoption is healthy enough that the analogous Android effort is clearly justified

Until then, this README is the entire Android directory. Resist the urge to scaffold "just in case."
