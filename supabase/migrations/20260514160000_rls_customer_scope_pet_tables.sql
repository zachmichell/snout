-- Fix a multi-tenant leak: is_org_member() returns true for ANY active
-- membership, including role='customer'. Pet parents are stored as
-- customer-role memberships, so the "Tenant isolation" policies
-- (qual is_org_member) granted every customer org-wide read/write over
-- pets and their care records — i.e. one customer could see and edit every
-- other customer's pets in the same facility.
--
-- Fix: introduce is_org_staff() (active membership whose role is NOT
-- customer) and scope the tenant-isolation policies on the pet/care tables
-- to staff. Customers keep access to THEIR OWN data through owner-scoped
-- policies (the pet_owners -> owners.profile_id = auth.uid() chain), which
-- already exist for SELECT and are added here for the writes the iOS /
-- owner-portal flows perform.
--
-- Scope: pets, pet_owners, pet_feeding_schedules, pet_medications,
-- report_cards. Other tables that use is_org_member (reservations, invoices,
-- etc.) are a known follow-up — see the broader RLS audit.

CREATE OR REPLACE FUNCTION public.is_org_staff(_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE profile_id = auth.uid()
      AND organization_id = _org_id
      AND active = true
      AND role <> 'customer'
  );
$$;

-- Reusable predicate fragments are inlined below (policies can't take params).

-- ===================== pets =====================
DROP POLICY IF EXISTS "Tenant isolation select" ON public.pets;
CREATE POLICY "Tenant isolation select" ON public.pets FOR SELECT
  USING (public.is_org_staff(organization_id));

-- INSERT stays open to any org member: a customer creating a pet in their
-- own facility is benign (they then link it to themselves via pet_owners,
-- which is owner-scoped). Cross-customer access is blocked at SELECT/UPDATE.
DROP POLICY IF EXISTS "Tenant isolation insert" ON public.pets;
CREATE POLICY "Tenant isolation insert" ON public.pets FOR INSERT
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Tenant isolation update" ON public.pets;
CREATE POLICY "Tenant isolation update" ON public.pets FOR UPDATE
  USING (
    public.is_org_staff(organization_id)
    OR id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.pets;
CREATE POLICY "Tenant isolation delete" ON public.pets FOR DELETE
  USING (public.is_org_staff(organization_id));

-- ===================== pet_owners =====================
DROP POLICY IF EXISTS "Tenant isolation select" ON public.pet_owners;
CREATE POLICY "Tenant isolation select" ON public.pet_owners FOR SELECT
  USING (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation insert" ON public.pet_owners;
CREATE POLICY "Tenant isolation insert" ON public.pet_owners FOR INSERT
  WITH CHECK (
    public.is_org_staff(organization_id)
    OR owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation update" ON public.pet_owners;
CREATE POLICY "Tenant isolation update" ON public.pet_owners FOR UPDATE
  USING (
    public.is_org_staff(organization_id)
    OR owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.pet_owners;
CREATE POLICY "Tenant isolation delete" ON public.pet_owners FOR DELETE
  USING (
    public.is_org_staff(organization_id)
    OR owner_id IN (SELECT id FROM public.owners WHERE profile_id = auth.uid())
  );

-- ===================== pet_feeding_schedules =====================
DROP POLICY IF EXISTS "Tenant isolation select" ON public.pet_feeding_schedules;
CREATE POLICY "Tenant isolation select" ON public.pet_feeding_schedules FOR SELECT
  USING (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation insert" ON public.pet_feeding_schedules;
CREATE POLICY "Tenant isolation insert" ON public.pet_feeding_schedules FOR INSERT
  WITH CHECK (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant isolation update" ON public.pet_feeding_schedules;
CREATE POLICY "Tenant isolation update" ON public.pet_feeding_schedules FOR UPDATE
  USING (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.pet_feeding_schedules;
CREATE POLICY "Tenant isolation delete" ON public.pet_feeding_schedules FOR DELETE
  USING (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

-- ===================== pet_medications =====================
DROP POLICY IF EXISTS "Tenant isolation select" ON public.pet_medications;
CREATE POLICY "Tenant isolation select" ON public.pet_medications FOR SELECT
  USING (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation insert" ON public.pet_medications;
CREATE POLICY "Tenant isolation insert" ON public.pet_medications FOR INSERT
  WITH CHECK (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant isolation update" ON public.pet_medications;
CREATE POLICY "Tenant isolation update" ON public.pet_medications FOR UPDATE
  USING (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.pet_medications;
CREATE POLICY "Tenant isolation delete" ON public.pet_medications FOR DELETE
  USING (
    public.is_org_staff(organization_id)
    OR pet_id IN (
      SELECT po.pet_id FROM public.pet_owners po
      JOIN public.owners o ON o.id = po.owner_id
      WHERE o.profile_id = auth.uid()
    )
  );

-- ===================== report_cards =====================
-- Customers never author cards; they read their own via the owner-scoped
-- SELECT policies that already exist ("Owner report_cards read",
-- "Owners read published cards"). Restrict tenant isolation to staff.
DROP POLICY IF EXISTS "Tenant isolation select" ON public.report_cards;
CREATE POLICY "Tenant isolation select" ON public.report_cards FOR SELECT
  USING (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation insert" ON public.report_cards;
CREATE POLICY "Tenant isolation insert" ON public.report_cards FOR INSERT
  WITH CHECK (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation update" ON public.report_cards;
CREATE POLICY "Tenant isolation update" ON public.report_cards FOR UPDATE
  USING (public.is_org_staff(organization_id));

DROP POLICY IF EXISTS "Tenant isolation delete" ON public.report_cards;
CREATE POLICY "Tenant isolation delete" ON public.report_cards FOR DELETE
  USING (public.is_org_staff(organization_id));
