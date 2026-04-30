# Parity Log

Append-only log of pure-logic helpers that exist in both the web and iOS codebases. New entries go at the top.

The convention: every helper that runs client-side and must produce the same result on web and iOS gets a row here. When you add or change such a helper on one side, the matching change on the other side lands in the same PR (or, if that's not feasible, the gap is recorded here with a "pending port" status until it does).

## Schema

| Helper | Web file | iOS file | Test contract | Status | Last verified |
|---|---|---|---|---|---|
| storage-download | `apps/web/src/lib/storage-download.ts` | `apps/ios/Snout/Utilities/StorageDownload.swift` | `apps/ios/SnoutTests/StorageDownloadTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |
| format | `apps/web/src/lib/format.ts` | `apps/ios/Snout/Utilities/Format.swift` | `apps/ios/SnoutTests/FormatTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |
| money | `apps/web/src/lib/money.ts` | `apps/ios/Snout/Utilities/Money.swift` | `apps/ios/SnoutTests/MoneyTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |
| booking | `apps/web/src/lib/booking.ts` | `apps/ios/Snout/Utilities/BookingHelpers.swift` | tests pending on both sides | iOS ported, tests pending | 2026-04-29 |

## Current state (web-only, awaiting iOS port)

These helpers exist on the web side and are listed in the iOS spec doc as candidates for porting. None have iOS implementations yet because the Xcode project hasn't been started. When the iOS app needs each helper, port it and update this row.

| Web helper | Lines | Notes for the Swift port |
|---|---|---|
| `apps/web/src/lib/storage-download.ts` | ~50 | Trivial; uses URLComponents in Swift. Add a parity test on the web first. |
| `apps/web/src/lib/format.ts` | varies | Date formatting maps to DateFormatter; keep locale handling explicit. |
| `apps/web/src/lib/care.ts` | static enums | Just port the enum data. Pure tables. |
| `apps/web/src/lib/money.ts` | small | Cents to currency string; use NumberFormatter with .currency. |
| `apps/web/src/lib/surcharge.ts` | ~70 | Defer until iOS implements payment (v3). |
| `apps/web/src/lib/credits.ts` | ~150 | Defer until iOS implements booking (v2). |
| ~~`apps/web/src/lib/booking.ts`~~ | ~~~90~~ | ~~Defer until iOS implements booking (v2).~~ — **Ported 2026-04-29** as `apps/ios/Snout/Utilities/BookingHelpers.swift` for the iOS booking wizard. See entry above. |

## Parity changes (append top)

_Use this section to log changes to a parity helper when they land. The most recent change is at the top._

### 2026-04-29 — Swift port of booking helpers (for iOS native booking wizard)

Ported `apps/web/src/lib/booking.ts` to `apps/ios/Snout/Utilities/BookingHelpers.swift` as part of the iOS native booking wizard build. Covers the same five helper surfaces:

- `generateTimeSlots(startHour, endHour)` — 15-minute slots, default 6→21
- `combineDateTime(dateStr, timeStr)` — "yyyy-MM-dd" + "HH:mm" → Date
- `tomorrowISODate()` — "yyyy-MM-dd" for tomorrow
- `diffNights(checkIn, checkOut)` — count of nights between two date strings
- `estimatePriceCents(...)` — switch on `ServiceDurationType`, multiply by pet count and nights/hours
- `priceUnitLabel(...)` — "/hr", "/day", "/night", etc.

Plus `formatDurationType(...)` which formats the enum for display ("Full day", "Overnight"), kept on iOS side because the web equivalent lives in `lib/money.ts` and we wanted the booking helper module self-contained.

**Behavior decisions to keep in sync:**
- Time slots: `endHour` minute > 0 is excluded ("21:00" is included; "21:15" is not).
- `combineDateTime`: iOS uses `America/Regina` timezone explicitly (matches CLAUDE.md). Web uses local timezone (could drift if web user is in a different timezone — flag for future hardening).
- `diffNights`: rounds to nearest day. Same on both sides.
- `priceUnitLabel`: returns plain "/hr", no leading space. Render-side adds spacing.

**Tests pending on both sides.** Per `docs/SHARED_LOGIC.md` the rule is "single test contract" — a `booking.test.ts` and `BookingHelpersTests.swift` covering the same input/output pairs. Not blocking the wizard build but worth landing in a follow-up batch.

### 2026-04-27 — Initial Swift ports of storage-download, format, money

Created Swift ports of three high-priority helpers as part of the iOS Xcode bootstrap. The Swift sides are covered by XCTest cases in `apps/ios/SnoutTests/`. The TypeScript sides do not yet have a test file under `apps/web/src/lib/__tests__/`; the next batch should add `storage-download.test.ts`, `format.test.ts`, and `money.test.ts` covering the same input/output pairs.

Notable behavior decisions to keep in sync:
- `slugifyForFilename`: returns `"file"` for empty, whitespace-only, or all-unsafe input.
- `withDownloadFilename`: replaces an existing `download` query param rather than appending a duplicate. URL parse failures fall back to string concat with percent-encoding.
- `formatCents`: uses the format string `"$%.2f %@"` (e.g. `"$52.50 CAD"`) to match the web's deliberately simple format. We are not using locale-aware currency formatting — parity beats locale niceties for now.
- `parseDollarsToCents`: rounds to the nearest cent; rejects negative numbers and non-numeric input.
