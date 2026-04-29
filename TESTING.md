# Testing

Snout has two test surfaces.

Unit tests run pure logic, hooks, and components against jsdom. They are
fast, deterministic, and run in CI on every pull request.

Integration tests run against a real Postgres via a local Supabase
instance. They cover SQL behavior, RLS, constraints, and concurrent
execution paths. They are slower, require a running database, and are
not yet wired into CI (planned for a later batch).

## Quick reference

```
npm test                    # unit tests, one shot
npm run test:watch          # unit tests, watching
npm run test:integration    # integration tests, requires Supabase running
npm run test:integration:watch
npm run test:all            # both
```

## Unit tests

Files match `src/**/*.{test,spec}.{ts,tsx}`. The test runner is Vitest
with the jsdom environment and React Testing Library.

Conventions:

- Co-locate tests next to the code they cover: `src/lib/credits.ts`
  has `src/lib/__tests__/credits.test.ts` next to it.
- Avoid hitting the network. If a function calls Supabase, mock it.
  For Supabase-touching code that is hard to mock, write an integration
  test instead.
- Write the smallest seed data that proves the rule. Long fixture
  files become a maintenance burden.

Run them with `npm test`.

## Integration tests

Files match `src/**/*.integration.test.ts`. They use the node
environment (no jsdom), share a Postgres, and run serially (one at a
time) so that constraints and concurrency tests behave deterministically
until per-test isolation lands in a follow-up batch.

### One-time local setup

1. Install the Supabase CLI: `npm install -g supabase` (or
   `brew install supabase/tap/supabase` on macOS).
2. Start the local stack from the repo root:
   ```
   npx supabase start
   ```
   The first run downloads Docker images, applies every migration in
   `supabase/migrations`, and prints API URL and service_role key when
   it finishes.
3. Copy the printed values into `.env.test` at the repo root (this
   file is gitignored):
   ```
   SUPABASE_TEST_URL=http://127.0.0.1:54321
   SUPABASE_TEST_SERVICE_ROLE_KEY=<paste service_role key>
   ```
4. Export them before running tests:
   ```
   export $(cat .env.test | xargs)
   npm run test:integration
   ```

Each test creates its own temporary organization in `beforeAll` and
deletes it in `afterAll`, so the suite leaves the database the way it
found it as long as the tear-down runs. A crashed run can leave one
`__test_*`-named org behind; sweep them by hand if it bothers you.

The setup file refuses to run if the URL and service key are missing.
By default it only allows local URLs (`127.0.0.1`, `localhost`). To
run against a non-local project (a dev or staging Supabase), set
`SUPABASE_TEST_ALLOW_NONLOCAL=1` in addition to the values above. Do
not point this at production.

### Stopping the local stack

```
npx supabase stop
```

### Test client

Integration tests build a service-role Supabase client via
`createTestClient()` from `src/test/supabase-test-client.ts`. Service
role bypasses RLS, which lets tests seed and assert without minting
user sessions. Production code must never use this helper.

## What we test, batch by batch

Batch 1.1 (this batch): pure-logic credit math in `src/lib/credits.ts`.
This is the foundation for the credit-consumption integration suite
that lands in Batch 1.3.

Batch 1.2: credit ledger schema migration. Schema-only, no test
changes.

Batch 1.3: credit consumption integration tests covering the named
edge cases. Lives at `src/lib/__tests__/credits.integration.test.ts`.
Covers consume_credits sufficient and insufficient, FIFO ordering and
spillover, expired purchases skipped at consume time, two concurrent
calls cannot both spend the last credit, refund re-credits the active
balance, expire_credits writes correct unused remainders and is
idempotent and skips fully-consumed purchases, apply_credit_adjustment
positive writes a single row and negative FIFO walks active purchases.
Cluster 1 explicitly does not include credit transfers; the brief
called for them but the product decision was no client-to-client
transfers, so no transfer test exists.

Batch 1.6: financial reconciliation test that seeds a small invoice
and payment set, runs `fetchEndOfDay` and `fetchRevenueByDate`, and
asserts the totals match a direct sum from the seed.

## CI

`.github/workflows/test.yml` defines two jobs that run on every pull
request and on every push to `main`.

The `unit` job runs `npm test` only. Lint is intentionally not gated
yet because the repo carries pre-existing eslint errors that need a
separate cleanup batch.

The `integration` job installs the Supabase CLI, runs `supabase start`
to spin up a local Postgres with every migration applied, captures the
generated API URL and service-role key, runs `npm run test:integration`
against that stack, then runs `supabase stop` even if the tests fail.
First-run cold start adds about 60-90 seconds to the job for image
pulls; subsequent runs are faster because GitHub Actions caches Docker
layers.
