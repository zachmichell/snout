# Parity Log

Append-only log of pure-logic helpers that exist in both the web and iOS codebases. New entries go at the top.

The convention: every helper that runs client-side and must produce the same result on web and iOS gets a row here. When you add or change such a helper on one side, the matching change on the other side lands in the same PR (or, if that's not feasible, the gap is recorded here with a "pending port" status until it does).

## Schema

| Helper | Web file | iOS file | Test contract | Status | Last verified |
|---|---|---|---|---|---|
| storage-download | `src/lib/storage-download.ts` | `ios/Snout/Utilities/StorageDownload.swift` | `ios/SnoutTests/StorageDownloadTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |
| format | `src/lib/format.ts` | `ios/Snout/Utilities/Format.swift` | `ios/SnoutTests/FormatTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |
| money | `src/lib/money.ts` | `ios/Snout/Utilities/Money.swift` | `ios/SnoutTests/MoneyTests.swift` (web tests pending) | iOS ported, web tests pending | 2026-04-27 |

## Current state (web-only, awaiting iOS port)

These helpers exist on the web side and are listed in the iOS spec doc as candidates for porting. None have iOS implementations yet because the Xcode project hasn't been started. When the iOS app needs each helper, port it and update this row.

| Web helper | Lines | Notes for the Swift port |
|---|---|---|
| `src/lib/storage-download.ts` | ~50 | Trivial; uses URLComponents in Swift. Add a parity test on the web first. |
| `src/lib/format.ts` | varies | Date formatting maps to DateFormatter; keep locale handling explicit. |
| `src/lib/care.ts` | static enums | Just port the enum data. Pure tables. |
| `src/lib/money.ts` | small | Cents to currency string; use NumberFormatter with .currency. |
| `src/lib/surcharge.ts` | ~70 | Defer until iOS implements payment (v3). |
| `src/lib/credits.ts` | ~150 | Defer until iOS implements booking (v2). |
| `src/lib/booking.ts` | ~90 | Defer until iOS implements booking (v2). |

## Parity changes (append top)

_Use this section to log changes to a parity helper when they land. The most recent change is at the top._

### 2026-04-27 — Initial Swift ports of storage-download, format, money

Created Swift ports of three high-priority helpers as part of the iOS Xcode bootstrap. The Swift sides are covered by XCTest cases in `ios/SnoutTests/`. The TypeScript sides do not yet have a test file under `src/lib/__tests__/`; the next batch should add `storage-download.test.ts`, `format.test.ts`, and `money.test.ts` covering the same input/output pairs.

Notable behavior decisions to keep in sync:
- `slugifyForFilename`: returns `"file"` for empty, whitespace-only, or all-unsafe input.
- `withDownloadFilename`: replaces an existing `download` query param rather than appending a duplicate. URL parse failures fall back to string concat with percent-encoding.
- `formatCents`: uses the format string `"$%.2f %@"` (e.g. `"$52.50 CAD"`) to match the web's deliberately simple format. We are not using locale-aware currency formatting — parity beats locale niceties for now.
- `parseDollarsToCents`: rounds to the nearest cent; rejects negative numbers and non-numeric input.
