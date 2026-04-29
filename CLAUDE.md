# CLAUDE.md

Ambient project context for Claude Code sessions on Snout. Auto-loaded on startup.

## What Snout is

Multi-tenant pet-care SaaS. Polyglot monorepo. One product, two clients (web + iOS), one shared Supabase backend. Future Android slot is scaffolded but empty.

## Repo layout

```
/Users/zachmichell/snout
├── apps/
│   ├── web/          Vite + React 18 + TypeScript + Tailwind + shadcn/ui — deployed to Vercel
│   ├── ios/          Native Swift + SwiftUI + supabase-swift SDK — Xcode project (XcodeGen from project.yml)
│   └── android/      Placeholder for future Kotlin scaffold
├── packages/
│   └── shared-types/ Generated TS types from Supabase schema (@snout/shared-types)
├── supabase/
│   ├── migrations/   Authoritative schema. Both clients read through it.
│   └── functions/    Edge functions. Both clients call the same endpoints.
└── docs/
    ├── IOS_APP_SPEC.md     Authoritative iOS handoff document — read first when working on iOS
    ├── SHARED_LOGIC.md     Decision tree for where new business logic lives — read before adding any
    └── PARITY_LOG.md       Current list of paired web/iOS helpers
```

## Toolchain

- **Package manager: Bun.** Repo root has `bun.lock`. Do not use npm or yarn.
- **Web build:** `bun run build` from repo root (proxies to `apps/web`)
- **Web dev server:** `bun run dev` from repo root
- **iOS project regen** (after editing `project.yml`): `cd apps/ios && xcodegen generate`
- **TS types regen** (after any DB migration): `bun run types:gen`

## Architectural rules — internalize these

### Logic placement priority

From `docs/SHARED_LOGIC.md`. Read it before placing any new code. The order:

1. **Postgres function or constraint** — if the logic is a function of database state, it lives as a SQL function. Both clients read the same answer.
2. **Edge function** — if the logic needs elevated privilege, third-party API access, or secrets, it's an edge function. Both clients invoke the same endpoint.
3. **Duplicated client logic** (last resort) — only when logic must run client-side for UX (live preview, form validation as the user types). Requires:
   - Parity comment at top of each file referencing the other (`// parity: apps/ios/Snout/Utilities/Foo.swift`)
   - Matching test contracts in both languages (same input/output pairs)
   - Entry in `docs/PARITY_LOG.md`

If you find yourself writing client-side logic that could have been a Postgres function, push back and ask whether the perceived UX cost (one network round-trip on submit) actually matters. Most of the time it doesn't.

### Multi-tenant invariants

- Every table has `organization_id`
- Authorization through RLS using the `is_org_member()` SECURITY DEFINER function
- Never write a query that doesn't naturally scope to the user's org through RLS — if RLS is the only thing protecting the query, that's correct, not a gap

### Data conventions

- **Money is integer cents.** Never store as float, never store as decimal-typed string. `price_cents`, `total_cents`, `surcharge_cents`. Format at render time.
- **Timezone is `America/Regina`.** Saskatchewan does not observe DST. All `timestamptz` is fine; explicit timezone math should use this zone.
- **Soft deletes only.** `deleted_at timestamptz`. Never hard-delete user data without explicit user-facing confirmation flow.
- **Edge functions return typed responses.** Use the generated types from `@snout/shared-types`.

### Brand and design tokens

- Palette: "Boho Rainbow"
- Accent (Camel): `#CBA48F`
- Background: `#F0E6E0`
- Typography: Fraunces (display headings) + DM Sans (body)
- Corner radii: card `8pt`, tile `16pt`, hero `20pt`
- Spacing scale: `4 / 8 / 12 / 16 / 24 / 32`
- iOS mirrors web tokens. When you change one, update the other.

## Backend

- Supabase project ID: `empdnuzfjgfnphwauhah`
- Project URL: `https://empdnuzfjgfnphwauhah.supabase.co`
- Web env vars (in `apps/web/.env`, gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (note: `PUBLISHABLE_KEY` not `ANON_KEY` — Lovable's naming, kept for compatibility)
- iOS reads from `apps/ios/Snout/Resources/Config.plist` (gitignored)

## Deployment

- **Web:** Vercel project `snout-web`, root directory `apps/web`. Auto-deploys on push to `main`. Preview deployments per branch.
- **iOS:** TestFlight via Xcode Archive → Organizer → App Store Connect.
- **Database migrations:** Apply via `supabase` CLI or Supabase MCP from the repo root. Both clients see the change automatically. Regenerate TS types after every migration.

## What Lovable was

Snout was originally prototyped in Lovable.dev as "Pawsitive Connect Hub." Migrated to Claude Code locally in April 2026 due to scalability concerns at user scale. **Lovable is fully disconnected.** Do not reference Lovable's environment, do not assume Lovable is auto-syncing, do not look for `.lovable/` directories — they were removed in the migration.

## When working on a task

1. Read `docs/SHARED_LOGIC.md` if there's any chance the task touches shared logic.
2. If touching iOS, also read `docs/IOS_APP_SPEC.md`.
3. Check `docs/PARITY_LOG.md` to see if there's already a paired helper.
4. Place new logic per the priority above.
5. If creating a parity pair, add the cross-reference comments AND the parity-log entry in the same PR — never separately.
6. Migrations: always reversible where possible, always tested locally before push.

## When in doubt

Read `docs/IOS_APP_SPEC.md` and `docs/SHARED_LOGIC.md` again. If the answer isn't there, it's an open question to resolve before assuming.
