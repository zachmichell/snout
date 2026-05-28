-- Native push device tokens (APNs for the iOS apps). Distinct from
-- push_subscriptions, which is Web Push-shaped (endpoint/p256dh/auth).
--
-- The staff app upserts its APNs token here after sign-in; the send-push
-- edge function (service role) reads tokens for the target users and
-- delivers via APNs. Users manage only their own rows; the service role
-- bypasses RLS to fan out.

CREATE TABLE IF NOT EXISTS public.device_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    token           text NOT NULL,
    platform        text NOT NULL DEFAULT 'apns',
    bundle_id       text,
    app             text NOT NULL DEFAULT 'staff',   -- 'staff' | 'client'
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS device_tokens_profile_idx
    ON public.device_tokens (profile_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS device_tokens_org_idx
    ON public.device_tokens (organization_id) WHERE deleted_at IS NULL;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Users manage only their own device tokens. The send-push function uses
-- the service role, which bypasses RLS.
DROP POLICY IF EXISTS "device_tokens_self" ON public.device_tokens;
CREATE POLICY "device_tokens_self" ON public.device_tokens FOR ALL
    USING (profile_id = (SELECT auth.uid()))
    WITH CHECK (profile_id = (SELECT auth.uid()));
