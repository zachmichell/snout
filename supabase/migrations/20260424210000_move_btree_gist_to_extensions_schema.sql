-- Move btree_gist out of public and into the extensions schema, matching
-- the pattern already used for pgcrypto, uuid-ossp, pg_stat_statements.
-- Addresses the "Extension in Public" advisor (lint 0014).
--
-- Existing GiST exclusion constraints reference their operator classes by
-- OID, so this move does not break them. The postgres role already has
-- extensions in its search_path; other roles inherit the DB-level default.
--
-- Why a DO block: the bare ALTER works in production (the connecting role
-- owns the extension), but the local Supabase CLI applies migrations as a
-- role that doesn't own btree_gist (it's owned by `postgres` from the base
-- image), so a fresh `supabase db reset` / CI run fails with
-- `must be owner of extension btree_gist (SQLSTATE 42501)`. Wrap the move:
--   1. Skip when the extension isn't in public (already moved, or absent).
--   2. Swallow the privilege error so the rest of the migration chain still
--      runs — the schema move is a hygiene lint, not a functional change.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'btree_gist' AND n.nspname = 'public'
    ) THEN
        -- Already in extensions schema (or extension absent). Nothing to do.
        RETURN;
    END IF;

    BEGIN
        ALTER EXTENSION btree_gist SET SCHEMA extensions;
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'Skipped moving btree_gist to extensions: current role does not own it. Move manually as postgres if needed.';
    END;
END
$$;
