# Shared Logic Conventions

How the web app and the iOS app stay in sync over time. This document is for Claude Code sessions on either side of the codebase.

## The core question

"If a piece of business logic exists, where should it live so that both the React app and the iOS app see the same answer?"

Three answers, in order of preference:

### 1. Postgres (best)

If the logic is a function of database state and produces a single answer, it lives as a SQL function or constraint. Both clients read the result through the same query.

Examples:
- `apply_stripe_payment` SQL function: idempotent payment recording. The web webhook calls it; the iOS in-app payment flow (when v3 lands) will call the same one.
- `consume_credits` SQL function: FIFO credit consumption. Same regardless of caller.
- `is_org_member` SQL function: authorization check used by RLS. Centralizes the membership rule.
- CHECK constraints on enums and severity columns: same validation regardless of caller.

When you add a new business rule that fits this pattern, add it as a SQL function or constraint, not as TypeScript code. Both clients then automatically agree.

### 2. Edge functions (good)

If the logic requires elevated privilege (service-role writes, third-party API calls, secret material), it lives as an edge function. Both clients invoke the same function.

Examples:
- `helcim-account-attach`, `create-helcim-checkout-session`, `helcim-webhook`: all of QBO and Stripe and Helcim integration.
- `send-push-notification`, `dispatch-owner-push`: notification fan-out.
- `report-critical-issue`: support escalation.

When you add a third-party integration or a service-role-gated mutation, add it as an edge function, not as duplicated logic in two clients.

### 3. Per-client implementation (last resort, requires parity)

If the logic must run client-side (input validation as the user types, rendering math, formatting), it ends up duplicated in TypeScript and Swift. This is the painful case, and we minimize it.

Examples that genuinely need this:
- `slugifyForFilename`, `withDownloadFilename`: filename construction at click time.
- `formatCentsShort`, `formatDateTime`: rendering.
- `calculateSurchargeCents`, `surchargeApplies`: live POS preview as the operator types an amount.
- `calculateCredits`: live booking-wizard preview of credits-vs-cash.

For each of these, the rule is:

1. **Single test contract.** The TypeScript test file under `apps/web/src/lib/__tests__/` and the Swift test file under `apps/ios/SnoutTests/` cover the same input/output pairs. Both must pass before either implementation ships.

2. **Cross-reference comment at the top of each implementation file.** The TS file says `// Swift parity: apps/ios/Snout/Utilities/StorageDownload.swift`. The Swift file says `// Web parity: apps/web/src/lib/storage-download.ts`. A grep for "parity:" finds every paired implementation in the repo.

3. **Update both when the rule changes.** A PR that changes one implementation must also change the other, plus update the test contract on both sides. The PR description names both files explicitly.

4. **Log the change in `docs/PARITY_LOG.md`** so the implementation pair is visible in repo history without having to grep.

## Decision tree

When you're about to write a new piece of logic, ask in this order:

1. Can this be a Postgres function or constraint? If yes, do that.
2. Does this need elevated privilege or third-party API access? If yes, edge function.
3. Does this need to run client-side for UX reasons (live preview, form validation as you type)? If yes, accept the duplication, add the parity entries, and write the test contract first.

If you find yourself writing client-side logic that could have been a Postgres function, push back and ask whether the perceived UX cost (one network round-trip on submit) actually matters for that flow. Most of the time it doesn't, and the centralized version saves you from a class of bugs later.

## What this looks like for QBO

QuickBooks integration is being built right now. By the rule above:

- OAuth token storage, refresh, and revocation: SQL functions + Vault (same pattern as Helcim). Postgres-authoritative.
- Customer/Item/Invoice/Payment push to QBO: edge functions. Both clients trigger via the same endpoint. iOS doesn't push directly; it calls a button that hits the same edge function the web does.
- Reconciliation queries: Postgres views + RLS-protected reads. Both clients render the same data.

Net result: the iOS app's QBO surface is "show the operator the sync state and offer a re-push button." Zero duplicated logic.

## What this looks like for the credit ledger (Cluster 1)

The credit ledger is the hardest case because it has both server-authoritative consumption (FIFO, refunds, expirations as Postgres functions) and client-side preview (the booking wizard shows "you'll use 2 full days from your package" before the user submits).

The split:

- `consume_credits` and friends: Postgres functions. Authoritative.
- `calculateCredits` in `apps/web/src/lib/credits.ts`: pure preview math. Duplicated in Swift when the iOS app implements booking. Same test contract.

The preview is allowed to be slightly optimistic (it doesn't lock rows). The actual consumption at submit time goes through the SQL function and is the source of truth. If the preview was wrong by a cent because of a race, the SQL function returns the truth and the UI shows the corrected number.

## When duplication breaks

If you ever find that the web and iOS implementations of the same helper have diverged:

1. Stop. Don't ship the divergent change.
2. Decide which one is correct (usually the one with the most recent test coverage).
3. Update the wrong one to match.
4. Add a parity-log entry noting the bug class.

A divergence found in production is a regression. Treat it that way.
