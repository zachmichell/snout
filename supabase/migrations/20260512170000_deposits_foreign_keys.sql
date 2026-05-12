-- Add the missing foreign key constraints on public.deposits.
--
-- The table was created with bare uuid columns (organization_id,
-- owner_id, pet_id, reservation_id, service_id) but no FK constraints
-- to back them. PostgREST infers embedded-relationship resolution from
-- the FK metadata, so queries like
--   .select("...owner:owner_id(id, first_name, last_name)...")
-- fail because PostgREST can't find the relationship in the schema
-- cache. The /deposits route currently throws "Could not find a
-- relationship between 'deposits' and 'owner_id'" on every load.
--
-- Verified before applying: zero orphan rows on owner_id, pet_id,
-- reservation_id, service_id, or organization_id, so the constraints
-- attach cleanly without any data cleanup.
--
-- ON DELETE rules:
--   * organization_id, owner_id — NO ACTION. Deleting an org or owner
--     with outstanding deposits should not silently drop the deposit
--     record; the operator should resolve it explicitly.
--   * pet_id, reservation_id, service_id — SET NULL. Deposits can
--     outlive any single pet/reservation/service (e.g., a refundable
--     deposit on a service that's later retired), so we keep the
--     deposit row and clear the link.

alter table public.deposits
  add constraint deposits_organization_id_fkey
    foreign key (organization_id) references public.organizations(id);

alter table public.deposits
  add constraint deposits_owner_id_fkey
    foreign key (owner_id) references public.owners(id);

alter table public.deposits
  add constraint deposits_pet_id_fkey
    foreign key (pet_id) references public.pets(id) on delete set null;

alter table public.deposits
  add constraint deposits_reservation_id_fkey
    foreign key (reservation_id) references public.reservations(id) on delete set null;

alter table public.deposits
  add constraint deposits_service_id_fkey
    foreign key (service_id) references public.services(id) on delete set null;

-- Tell PostgREST to reload its schema cache so the new FKs are
-- visible to embedded-relationship queries without waiting for the
-- ambient cache TTL.
notify pgrst, 'reload schema';
