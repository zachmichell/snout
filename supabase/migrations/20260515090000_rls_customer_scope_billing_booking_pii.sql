-- RLS audit, phase 2: lock down the customer-facing PII tables that still
-- relied on is_org_member for tenant isolation. Like the pet tables (phase 1,
-- migration 20260514160000), is_org_member treats customer-role memberships
-- as members, so any customer could read/write every other customer's
-- invoices, payments, bookings, vaccinations, contacts, etc. in the facility.
--
-- For each table: flip the tenant-isolation policies to is_org_staff and add
-- owner-scoped policies for the access the owner portal / iOS app actually
-- needs (read their own; create their own bookings / sign their own waivers).
-- Writes that happen server-side (webhooks, edge functions) use the service
-- role and bypass RLS, so they are unaffected.
--
-- Reference/config tables (services, locations, groomers, subscription
-- packages, class types/instances) and the remaining staff-only operational
-- tables (leads, call_logs, pos_*, quickbooks_*, survey_responses, …) are a
-- separate follow-up — a customer reading the shared facility catalog is not
-- a cross-customer privacy leak, and the staff-only flip is mechanical.

-- Helper fragments (inlined): caller's owner ids and owned pet ids.
--   owners:  owner_id IN (SELECT id FROM owners WHERE profile_id = auth.uid())
--   pets:    pet_id   IN (SELECT po.pet_id FROM pet_owners po
--                          JOIN owners o ON o.id = po.owner_id
--                          WHERE o.profile_id = auth.uid())

-- ============================================================
-- Flip tenant-isolation policies to staff-only (is_org_staff)
-- ============================================================

-- invoices + line/tax/payment children
ALTER POLICY "Tenant isolation select" ON public.invoices USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.invoices WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.invoices USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.invoices USING (public.is_org_staff(organization_id));

ALTER POLICY "Tenant isolation select" ON public.invoice_lines USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.invoice_lines WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.invoice_lines USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.invoice_lines USING (public.is_org_staff(organization_id));

ALTER POLICY "Tenant isolation select" ON public.invoice_taxes USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.invoice_taxes WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.invoice_taxes USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.invoice_taxes USING (public.is_org_staff(organization_id));

ALTER POLICY "Tenant isolation select" ON public.payments USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.payments WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.payments USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.payments USING (public.is_org_staff(organization_id));

-- owner_subscriptions (no delete policy)
ALTER POLICY "Org members read owner subs" ON public.owner_subscriptions USING (public.is_org_staff(organization_id));
ALTER POLICY "Org members insert owner subs" ON public.owner_subscriptions WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Org members update owner subs" ON public.owner_subscriptions USING (public.is_org_staff(organization_id));

-- credit_ledger
ALTER POLICY "Tenant isolation select" ON public.credit_ledger USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.credit_ledger WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.credit_ledger USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.credit_ledger USING (public.is_org_staff(organization_id));

-- grooming_appointments
ALTER POLICY "Org members can view grooming appointments" ON public.grooming_appointments USING (public.is_org_staff(organization_id));
ALTER POLICY "Org members can insert grooming appointments" ON public.grooming_appointments WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Org members can update grooming appointments" ON public.grooming_appointments USING (public.is_org_staff(organization_id));
ALTER POLICY "Org members can delete grooming appointments" ON public.grooming_appointments USING (public.is_org_staff(organization_id));

-- vaccinations
ALTER POLICY "Tenant isolation select" ON public.vaccinations USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.vaccinations WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.vaccinations USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.vaccinations USING (public.is_org_staff(organization_id));

-- emergency_contacts
ALTER POLICY "Tenant isolation select" ON public.emergency_contacts USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.emergency_contacts WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.emergency_contacts USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.emergency_contacts USING (public.is_org_staff(organization_id));

-- payment_methods
ALTER POLICY "Org members can view payment methods" ON public.payment_methods USING (public.is_org_staff(organization_id));
ALTER POLICY "Org members can insert payment methods" ON public.payment_methods WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Org members can update payment methods" ON public.payment_methods USING (public.is_org_staff(organization_id));
ALTER POLICY "Org members can delete payment methods" ON public.payment_methods USING (public.is_org_staff(organization_id));

-- waiver_signatures
ALTER POLICY "Tenant isolation select" ON public.waiver_signatures USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.waiver_signatures WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.waiver_signatures USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.waiver_signatures USING (public.is_org_staff(organization_id));

-- owners (customers keep their existing "Owner self-read" SELECT policy)
ALTER POLICY "Tenant isolation select" ON public.owners USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.owners WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.owners USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.owners USING (public.is_org_staff(organization_id));

-- reservations (customers keep "Owner reservations read"; add owner INSERT below)
ALTER POLICY "Tenant isolation select" ON public.reservations USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.reservations WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.reservations USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.reservations USING (public.is_org_staff(organization_id));

-- reservation_pets
ALTER POLICY "Tenant isolation select" ON public.reservation_pets USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation insert" ON public.reservation_pets WITH CHECK (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation update" ON public.reservation_pets USING (public.is_org_staff(organization_id));
ALTER POLICY "Tenant isolation delete" ON public.reservation_pets USING (public.is_org_staff(organization_id));

-- ============================================================
-- Owner-scoped policies for customer access to their OWN data
-- ============================================================

-- invoices: read own
DROP POLICY IF EXISTS "Owner invoices read" ON public.invoices;
CREATE POLICY "Owner invoices read" ON public.invoices FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- invoice_lines / invoice_taxes / payments: read via parent invoice ownership
DROP POLICY IF EXISTS "Owner invoice_lines read" ON public.invoice_lines;
CREATE POLICY "Owner invoice_lines read" ON public.invoice_lines FOR SELECT
  USING (invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())));

DROP POLICY IF EXISTS "Owner invoice_taxes read" ON public.invoice_taxes;
CREATE POLICY "Owner invoice_taxes read" ON public.invoice_taxes FOR SELECT
  USING (invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())));

DROP POLICY IF EXISTS "Owner payments read" ON public.payments;
CREATE POLICY "Owner payments read" ON public.payments FOR SELECT
  USING (invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())));

-- owner_subscriptions: read own
DROP POLICY IF EXISTS "Owner subscriptions read" ON public.owner_subscriptions;
CREATE POLICY "Owner subscriptions read" ON public.owner_subscriptions FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- credit_ledger: read own
DROP POLICY IF EXISTS "Owner credit_ledger read" ON public.credit_ledger;
CREATE POLICY "Owner credit_ledger read" ON public.credit_ledger FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- grooming_appointments: read + create own
DROP POLICY IF EXISTS "Owner grooming read" ON public.grooming_appointments;
CREATE POLICY "Owner grooming read" ON public.grooming_appointments FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));
DROP POLICY IF EXISTS "Owner grooming insert" ON public.grooming_appointments;
CREATE POLICY "Owner grooming insert" ON public.grooming_appointments FOR INSERT
  WITH CHECK (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- vaccinations: read own pets'
DROP POLICY IF EXISTS "Owner vaccinations read" ON public.vaccinations;
CREATE POLICY "Owner vaccinations read" ON public.vaccinations FOR SELECT
  USING (pet_id IN (
    SELECT po.pet_id FROM public.pet_owners po
    JOIN public.owners o ON o.id = po.owner_id
    WHERE o.profile_id = auth.uid()));

-- emergency_contacts: read own
DROP POLICY IF EXISTS "Owner emergency_contacts read" ON public.emergency_contacts;
CREATE POLICY "Owner emergency_contacts read" ON public.emergency_contacts FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- payment_methods: read own (writes happen via Stripe webhook / service role)
DROP POLICY IF EXISTS "Owner payment_methods read" ON public.payment_methods;
CREATE POLICY "Owner payment_methods read" ON public.payment_methods FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- waiver_signatures: read + create own
DROP POLICY IF EXISTS "Owner waiver_signatures read" ON public.waiver_signatures;
CREATE POLICY "Owner waiver_signatures read" ON public.waiver_signatures FOR SELECT
  USING (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));
DROP POLICY IF EXISTS "Owner waiver_signatures insert" ON public.waiver_signatures;
CREATE POLICY "Owner waiver_signatures insert" ON public.waiver_signatures FOR INSERT
  WITH CHECK (owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- reservations: owner self-serve booking (status enforced by app; ownership here)
DROP POLICY IF EXISTS "Owner reservations insert" ON public.reservations;
CREATE POLICY "Owner reservations insert" ON public.reservations FOR INSERT
  WITH CHECK (primary_owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid()));

-- reservation_pets: read + create for the caller's own reservations
DROP POLICY IF EXISTS "Owner reservation_pets read" ON public.reservation_pets;
CREATE POLICY "Owner reservation_pets read" ON public.reservation_pets FOR SELECT
  USING (reservation_id IN (
    SELECT r.id FROM public.reservations r
    WHERE r.primary_owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())));
DROP POLICY IF EXISTS "Owner reservation_pets insert" ON public.reservation_pets;
CREATE POLICY "Owner reservation_pets insert" ON public.reservation_pets FOR INSERT
  WITH CHECK (reservation_id IN (
    SELECT r.id FROM public.reservations r
    WHERE r.primary_owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())));
