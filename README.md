# Snout

Multi-tenant pet-care SaaS. Web + iOS clients, shared Supabase backend.

## Repository structure

This is a polyglot monorepo. The web app and the iOS app share a single Supabase project (schema, RLS policies, edge functions) but each has its own native UI layer.

```
snout/
├── apps/
│   ├── web/              # Vite + React + shadcn/ui (deployed to Vercel)
│   ├── ios/              # SwiftUI + supabase-swift (deployed via App Store Connect)
│   └── android/          # Placeholder — Kotlin + Compose, scaffold when needed
├── packages/
│   └── shared-types/     # Generated Supabase TypeScript types, consumed by apps/web
├── supabase/             # Migrations + edge functions (single source of truth)
├── docs/                 # IOS_APP_SPEC, SHARED_LOGIC, PARITY_LOG
└── package.json          # Bun workspace root
```

## How the two clients stay in sync

See `docs/SHARED_LOGIC.md`. In short: Postgres > edge function > duplicated client logic. Every duplicated helper has a parity entry in `docs/PARITY_LOG.md` and matching tests on both sides.

## Local development

### Prerequisites

- [Bun](https://bun.sh) for the JS workspace
- [Supabase CLI](https://supabase.com/docs/guides/cli) for migrations and type generation
- Xcode 15+ for the iOS app

### Web app

```bash
bun install
bun run dev          # starts apps/web on http://localhost:8080
bun run build        # production build
bun run test         # unit tests
```

### iOS app

```bash
open apps/ios/Snout.xcodeproj
# Cmd+R to build and run in the simulator
```

First-time setup requires copying `apps/ios/Snout/Resources/Config.example.plist` to `Config.plist` and filling in the Supabase URL and anon key. See `apps/ios/README.md` for full setup instructions.

### Regenerating shared types

After a database migration:

```bash
bun run types:gen
```

This pulls the latest schema from Supabase and writes generated TypeScript types into `packages/shared-types/src/database.ts`.

## Deployment

- **Web** → Vercel project pointing at `apps/web/` as the root directory
- **iOS** → Archive in Xcode → upload to App Store Connect → distribute via TestFlight or App Store
- **Backend** → Supabase project `empdnuzfjgfnphwauhah`. Migrations applied via `supabase db push`.
