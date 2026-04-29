-- Narrow the attack surface on the public leads INSERT policy.
--
-- The policy `leads_public_insert` has `WITH CHECK (true)` because the
-- feature is a public lead-capture form reachable by anon/authenticated.
-- Removing the policy without knowing the external consumer would break
-- the integration; the proper rate-limit/captcha path (edge function,
-- tracked as follow-up 3b) needs that consumer identified first.
--
-- In the meantime, shape constraints reject the easiest spam payloads:
-- empty names, absurd lengths, obvious non-emails. Legitimate form
-- submissions are unaffected; garbage is blocked.

ALTER TABLE public.leads
  ADD CONSTRAINT leads_name_length
    CHECK (char_length(name) BETWEEN 1 AND 200),
  ADD CONSTRAINT leads_email_shape
    CHECK (
      email IS NULL
      OR (char_length(email) BETWEEN 3 AND 320
          AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    ),
  ADD CONSTRAINT leads_phone_length
    CHECK (phone IS NULL OR char_length(phone) BETWEEN 5 AND 50),
  ADD CONSTRAINT leads_pet_name_length
    CHECK (pet_name IS NULL OR char_length(pet_name) <= 100),
  ADD CONSTRAINT leads_pet_breed_length
    CHECK (pet_breed IS NULL OR char_length(pet_breed) <= 100),
  ADD CONSTRAINT leads_source_length
    CHECK (source IS NULL OR char_length(source) <= 100),
  ADD CONSTRAINT leads_notes_length
    CHECK (notes IS NULL OR char_length(notes) <= 2000);
