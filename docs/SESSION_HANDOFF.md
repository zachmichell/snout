# Session Handoff — May 4, 2026

Context for the next Claude Code session. Written at the end of a long migration day. Read this before doing anything else iOS- or deployment-related.

## What was done in the previous session

Migrated from three disconnected codebases (local `fella-fetch-hub` web app, separate iOS Xcode project, stale Lovable-hosted web app) into one polyglot monorepo at `/Users/zachmichell/snout`. Repo lives at `github.com/zachmichell/snout`.

Specifics that landed:

- Repo restructured into `apps/web/`, `apps/ios/`, `apps/android/` (placeholder), `packages/shared-types/`, `supabase/`, `docs/`. All 421 files moved with `git mv` to preserve history.
- Bun workspaces at the root (`bun.lock`, `package.json` with `workspaces: ["apps/web", "packages/*"]`). Do not use npm or yarn.
- `packages/shared-types/` extracted as `@snout/shared-types` — generated TS types from Supabase schema.
- Lovable fully disconnected. `.lovable/` directory removed. Do not look for it.
- Web app deployed to Vercel: project `snout-web`, root directory `apps/web`, auto-deploys on push to `main`. Production URL works. Env vars set: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (note: PUBLISHABLE_KEY, not ANON_KEY — Lovable's naming, kept for compatibility).
- `CLAUDE.md` written at repo root with ambient project context — auto-loaded by Claude Code on session start.
- `docs/IOS_APP_SPEC.md`, `docs/SHARED_LOGIC.md`, and `docs/PARITY_LOG.md` updated with the new `apps/` paths.
- Vercel coding-agent plugin installed (`npx plugins add vercel/vercel-plugin`). Adds 25 skills, 6 commands, 3 agents, and MCP tools for deploys/logs/builds. Available in any new Claude Code session.

## Current branch state

`main` and `feature/grooming-booking-wizard` both have:
- Monorepo restructure
- `Snout.xcodeproj` tracked in git (was previously gitignored — broke Xcode Cloud)
- `Package.resolved` tracked in git (same root cause)

`feature/grooming-booking-wizard` additionally has:
- WIP grooming booking wizard (~19 modified Swift files)
- New iOS components (PetAvatar, SnoutGlyph)
- New iOS Views — More tab (AgreementsView, ClientDetailsView, InvoicesView, MoreShared, PaymentMethodsView, PetsView)
- New iOS view: BuyCreditsView
- Glyph asset library
- New edge function: `create-package-checkout-session`
- Modified edge function: `stripe-connect-webhook` (Stripe idempotency hardening)
- 2 new SQL migrations (uncommitted to main):
  - `20260430010000_add_message_attachments.sql`
  - `20260430020000_owner_subscriptions_stripe_idempotency.sql`

All of the above is committed and pushed to the `feature/grooming-booking-wizard` branch on GitHub. None of it has been merged to `main` yet.

## Open items, in priority order

### P0 — TestFlight blocker (Apple-side, almost certainly resolves on its own)

**Status:** Xcode Cloud builds the iOS app successfully through the archive step, but Distribute App fails because the project's signing team is "Zach Michell (Individual)" — Xcode is not surfacing the paid Developer Team in the dropdown despite:
- The Apple ID `maikelconsultingcorp@gmail.com` being signed in to Xcode
- That account having a confirmed paid Apple Developer Program membership (Team ID `W55RNZ9Q4Q`, role Admin)
- The bundle ID `org.snoutapp.snout` being registered as an App ID under the paid team in the Apple Developer portal
- Multiple sign-out/sign-in cycles, Xcode restarts, and project bundle-ID toggles

**Tried already:**
- Quit/restart Xcode several times
- Sign out and back in to Apple Account in Xcode
- Toggle "Automatically manage signing" off and on
- Click "Try Again" on the "Communication with Apple failed" error

**To try first thing next session, in order:**
1. Just open Xcode and check the Team dropdown. Apple's backend often takes overnight to propagate team membership and App ID associations to Xcode's view. Most likely fix is "wait."
2. If still only one option, in Signing & Capabilities click the bundle identifier field, change it to `org.snoutapp.snouttest`, then back to `org.snoutapp.snout`. Forces Xcode to re-evaluate available teams.
3. If still broken, delete `~/Library/Developer/Xcode/DerivedData` and restart Xcode.
4. If still broken, sign out of Apple ID system-wide via System Settings → Apple ID, sign back in, then redo Xcode sign-in.

Once a paid team is selectable:
- Select it in Team dropdown
- Wait for provisioning profile to generate (30-60 sec)
- **Product → Archive**
- **Distribute App → App Store Connect → Upload**
- Build appears in App Store Connect → TestFlight after 10-30 min processing
- TestFlight app on iPhone shows the build, install it

### P1 — Xcode Cloud Config.plist secret injection

If/when you want Xcode Cloud to fully archive (not just build), it currently fails on missing `apps/ios/Snout/Resources/Config.plist`. That file holds the iOS app's Supabase URL and publishable key, and is correctly gitignored as it contains secrets.

The proper fix: add a CI script that generates Config.plist from Xcode Cloud environment variables. Outline:

1. In App Store Connect → Xcode Cloud → workflow → Environment Variables, add:
   - `SUPABASE_URL` (value: `https://empdnuzfjgfnphwauhah.supabase.co`)
   - `SUPABASE_PUBLISHABLE_KEY` (value: the JWT — mark as Secret)
2. Note: when initially attempted, the publishable key was rejected with "invalid value" — likely needs the "Secret" checkbox checked.
3. Create `ci_scripts/ci_post_clone.sh` (must be executable, must be in repo root):

```bash
#!/bin/sh
set -e
CONFIG_DIR="$CI_PRIMARY_REPOSITORY_PATH/apps/ios/Snout/Resources"
CONFIG_FILE="$CONFIG_DIR/Config.plist"
cat > "$CONFIG_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>SUPABASE_URL</key>
    <string>${SUPABASE_URL}</string>
    <key>SUPABASE_PUBLISHABLE_KEY</key>
    <string>${SUPABASE_PUBLISHABLE_KEY}</string>
</dict>
</plist>
EOF
echo "Generated Config.plist for Xcode Cloud build"
```

4. Commit and push. Xcode Cloud auto-runs this before each build.

This is only needed if/when you commit to Xcode Cloud as the iOS CI. Manual `Product → Archive → Distribute` from local Xcode does not need it because Config.plist exists locally.

### P2 — GitHub Actions test workflow failing

`.github/workflows/test.yml` runs Unit tests and Integration tests jobs that fail in 4-6 seconds — likely setup errors, not real test failures. Pre-monorepo workflow that hasn't been updated for the new structure. Most likely causes:
- Workflow uses `npm` or `yarn` but repo is now Bun
- Workflow looks for files at old paths like `src/` instead of `apps/web/src/`

Fix path: read `.github/workflows/test.yml`, update to use Bun and `apps/web/` paths, or disable the workflow entirely if you're not relying on it. Solo dev — `bun run build` locally probably covers what you need.

### P3 — Xcode Cloud branch matching

Workflow's Branch Changes condition was set to `feature/*` (wildcard) but App Store Connect rejects wildcards. Currently configured with literal branch names: `main` and `feature/grooming-booking-wizard`. As you create new feature branches, you'll need to add each one explicitly until Apple fixes wildcard support. Or switch to "Any Branch" if you want everything to build (will burn more CI minutes).

### P4 — Cosmetic: zsh startup warning

Every new terminal shows `/Users/zachmichell/.zprofile:3: no such file or directory: /opt/homebrew/bin/brew`. Bun was added to `.zprofile` during this session but Homebrew was never installed at the standard Apple Silicon path. Either:
- Install Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Or remove the orphan line from `.zprofile`

Not blocking anything, just noisy.

### P5 — Merge feature branch to main (when ready)

`feature/grooming-booking-wizard` is well ahead of `main` with substantive work. When the wizard is shipped:
- Open a PR via GitHub UI for code review (even solo, the PR view forces a final read-through)
- Squash merge to `main`
- Vercel will auto-deploy
- Xcode Cloud will auto-build (if/when team-signing is fixed)

## Architectural rules to remember (from CLAUDE.md and SHARED_LOGIC.md)

These don't change between sessions. Internalize them:

1. **Logic placement priority:** Postgres function/constraint > edge function > duplicated client logic. Last-resort duplication requires parity comment + matching test contracts + entry in `docs/PARITY_LOG.md`.
2. **Multi-tenant invariants:** every table has `organization_id`, RLS via `is_org_member()`. Never write a query that doesn't naturally scope to the user's org through RLS.
3. **Money is integer cents.** Never floats. Format at render time.
4. **Timezone is `America/Regina`.** SK doesn't observe DST.
5. **Soft deletes only** (`deleted_at timestamptz`). No hard deletes without explicit user-facing confirmation.
6. **Database migrations** apply via Supabase CLI/MCP from repo root. Regenerate TS types after every migration with `bun run types:gen`.

## Stack quick-reference

- **Web:** Vite + React 18 + TS + Tailwind + shadcn/ui, deployed to Vercel
- **iOS:** Native Swift + SwiftUI + supabase-swift SDK + XcodeGen
- **Backend:** Supabase project `empdnuzfjgfnphwauhah`
- **Package manager:** Bun (root), `bun run dev` and `bun run build` from repo root

## When in doubt

Read `CLAUDE.md`, `docs/SHARED_LOGIC.md`, `docs/IOS_APP_SPEC.md`, `docs/PARITY_LOG.md`. If the answer isn't there, surface the question — don't assume.
