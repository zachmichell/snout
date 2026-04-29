-- Move btree_gist out of public and into the extensions schema, matching
-- the pattern already used for pgcrypto, uuid-ossp, pg_stat_statements.
-- Addresses the "Extension in Public" advisor (lint 0014).
--
-- Existing GiST exclusion constraints reference their operator classes by
-- OID, so this move does not break them. The postgres role already has
-- extensions in its search_path; other roles inherit the DB-level default.

ALTER EXTENSION btree_gist SET SCHEMA extensions;
