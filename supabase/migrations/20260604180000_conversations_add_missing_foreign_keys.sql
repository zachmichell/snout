-- conversations was created without foreign-key constraints on its two
-- relational columns (organization_id, owner_id). PostgREST relies on FK
-- metadata to resolve embedded resources (`owner:owners(...)`) — without
-- the constraint it returns PGRST200 "Could not find a relationship
-- between 'conversations' and 'owners' in the schema cache". The staff
-- messaging lane has been silently empty for every staff user because of
-- this; surfaced only after the load-error banner from PR #89 made the
-- error visible.

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_owner_id_fkey
    FOREIGN KEY (owner_id)
    REFERENCES public.owners(id)
    ON DELETE CASCADE;

-- Force PostgREST to reload its schema cache so the new FKs are visible
-- immediately on the next request, rather than after the next restart.
NOTIFY pgrst, 'reload schema';
