# @snout/shared-types

Generated TypeScript types for the Snout Supabase database schema. Consumed by `apps/web/`.

## Regenerating

After any database migration, regenerate the types from the repo root:

```bash
bun run types:gen
```

This runs:

```bash
supabase gen types typescript --project-id empdnuzfjgfnphwauhah > packages/shared-types/src/database.ts
```

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) to be installed and authenticated.

## Why a package and not just a file in apps/web/

Two reasons:

1. **Future Android.** When the Android client lands, it'll need an analogous Kotlin type generation step. Having the types as their own package makes it explicit that this is a shared concern, not a web-app-internal detail.
2. **Future packages.** If we ever need a shared validation package (zod schemas, parity helpers), it'll live in `packages/` next to this one.

## What lives here vs. elsewhere

- **Here:** Generated `database.ts` with table row types, enum types, function arg/return types.
- **`apps/web/src/integrations/supabase/`:** Supabase client wiring and any web-specific query helpers.
- **`apps/ios/Snout/Models/`:** Hand-written Swift Codable structs (mirroring the same schema).

If you find yourself wanting to add hand-edited TS types here, stop — those belong in `apps/web/` instead. This package is for generated artifacts only.
