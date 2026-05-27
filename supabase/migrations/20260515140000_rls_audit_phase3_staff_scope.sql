-- RLS audit, phase 3 (final): scope the remaining is_org_member policies.
--
-- After phases 1 (pets/care) and 2 (billing/booking PII), the leftover
-- is_org_member policies fall into two groups:
--
--   * Shared facility config / catalog (services, locations, groomers,
--     subscription packages, class types/instances, settings, …). A customer
--     reading their OWN facility's catalog is not a cross-customer privacy
--     leak, so SELECT stays open to members; only writes move to staff.
--
--   * Everything else holds cross-customer data or is staff-only (activity
--     log, leads, call logs, documents, payouts, quickbooks, pos carts,
--     conversations/messages, incidents, care logs, survey responses, …).
--     Both reads and writes move to staff. Customers retain access to their
--     OWN rows through the owner-scoped policies added in phases 1–2 (and the
--     pre-existing "Owner …" policies for conversations, messages, incidents,
--     enrollments, etc.).
--
-- Every customer WRITE path is already covered by an owner-scoped policy, so
-- flipping the is_org_member write policies to is_org_staff cannot break the
-- customer apps. The one intentional exception — pets INSERT (= is_org_member,
-- set in phase 1 so a parent can create a pet in their own facility) — is
-- explicitly skipped.

DO $$
DECLARE
  r record;
  -- Shared config/catalog: SELECT may stay open to members (incl. customers).
  keep_member_select text[] := ARRAY[
    'services','locations','location_hours','groomers','subscription_packages',
    'class_instances','class_types','agreement_templates','waivers','portal_settings',
    'capacity_settings','pricing_rules','cancellation_policies','cancellation_reasons',
    'deposit_settings','precheck_settings','survey_settings','refund_reasons',
    'service_deposit_overrides','loyalty_settings','loyalty_rewards','notification_settings',
    'breeds','veterinarians','promotions','surcharge_settings','tax_rules','retail_products',
    'self_wash_bays','suites','kennel_runs','playgroups','checklist_templates'
  ];
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual = 'is_org_member(organization_id)' OR with_check = 'is_org_member(organization_id)')
  LOOP
    -- Preserve the intentional customer pet-creation path (phase 1).
    IF r.tablename = 'pets' THEN
      CONTINUE;
    END IF;
    -- Shared config/catalog: leave SELECT open to members; writes still flip.
    IF r.cmd = 'SELECT' AND r.tablename = ANY (keep_member_select) THEN
      CONTINUE;
    END IF;

    IF r.cmd = 'INSERT' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK (public.is_org_staff(organization_id))',
        r.policyname, r.tablename);
    ELSE
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_org_staff(organization_id))',
        r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;

-- ---- Special-case policies (not the bare is_org_member(organization_id)) ----

-- Staff-side message policies (customers use the separate "Owner …" policies).
ALTER POLICY "Staff select messages" ON public.messages
  USING (EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = messages.conversation_id
                   AND public.is_org_staff(c.organization_id)));
ALTER POLICY "Staff update messages" ON public.messages
  USING (EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = messages.conversation_id
                   AND public.is_org_staff(c.organization_id)));
ALTER POLICY "Staff insert messages" ON public.messages
  WITH CHECK (
    sender_type = 'staff'::message_sender_type
    AND sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.conversations c
                WHERE c.id = messages.conversation_id
                  AND public.is_org_staff(c.organization_id)));

-- Email log: financial/PII send history — staff only.
ALTER POLICY "Org members can view email log" ON public.email_log
  USING ((organization_id IS NOT NULL) AND public.is_org_staff(organization_id));

-- Organizations: members may READ their org (name/branding); only staff UPDATE.
ALTER POLICY "Members update org" ON public.organizations
  USING (public.is_org_staff(id));

-- Webcams: customers read their own pet's feed via "Owner webcams read".
ALTER POLICY "webcams_select_member" ON public.webcams
  USING ((deleted_at IS NULL) AND public.is_org_staff(organization_id));

-- Helcim processed-events ledger — staff/system only.
ALTER POLICY "helcim_processed_events_select" ON public.helcim_processed_events
  USING ((organization_id IS NULL) OR public.is_org_staff(organization_id));

-- self_wash_bays_update carries BOTH a USING and a WITH CHECK clause; the DO
-- block above only rewrote USING for non-INSERT policies, so pin WITH CHECK too.
ALTER POLICY "self_wash_bays_update" ON public.self_wash_bays
  USING (public.is_org_staff(organization_id))
  WITH CHECK (public.is_org_staff(organization_id));

-- Left intentionally member-readable:
--   * "Members read org" (organizations) — customers need their org.
--   * changelog_entries — product release notes (org-nullable/global).
--   * groomer_availability / groomer_working_hours — booking reference;
--     customer slot lookups go through SECURITY DEFINER RPCs anyway.
