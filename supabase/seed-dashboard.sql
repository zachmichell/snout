-- Self-refreshing dashboard seed for the Smoke Test 2 Kennels org.
--
-- Re-runnable: cleans up the previous run and re-inserts reservations relative
-- to "today" (America/Regina), so the Pack View always demos a populated day.
--
-- What it seeds (10 reservations covering every dashboard state):
--   Coming In  (confirmed, today): Biscuit/Daycare, Cooper/Boarding, Daisy/Grooming, Luna/Training
--   In The Pack (checked_in):       Rocky, Pepper (daycare), Max (boarding), Bella (boarding)
--   Going Home (checked_in, end today): Rocky, Pepper, Max
--   Sleeping Over (boarding, end > today): Bella
--   Requests (status=requested, today): Biscuit/Daycare, Luna/Boarding
--
-- Owners, pets, services, and suites are seeded once by an earlier run and are
-- not touched here — only the time-sensitive reservations are refreshed.
--
-- Run via Supabase SQL Editor or `psql` whenever the demo data needs a refresh.

DO $$
DECLARE
  -- Today midnight in America/Regina, expressed as a UTC timestamptz
  t timestamptz := (date_trunc('day', timezone('America/Regina', NOW())) AT TIME ZONE 'America/Regina');

  org      uuid := 'd08719d6-a451-4121-907c-01bc8f91d6a4';
  loc      uuid := 'a3fbc96e-5d46-468a-9217-faf33d4b9b78';

  daycare  uuid := '0af4aeaf-4963-4deb-a5eb-bc636c44a5c2';
  boarding uuid := '11111111-0001-4111-8111-111111111111';
  grooming uuid := '11111111-0002-4111-8111-111111111111';
  training uuid := '11111111-0003-4111-8111-111111111111';

  -- Owners
  o_sarah  uuid := '22222222-0001-4222-8222-222222222222';
  o_mike   uuid := '22222222-0002-4222-8222-222222222222';
  o_jenna  uuid := '22222222-0003-4222-8222-222222222222';
  o_alex   uuid := '22222222-0004-4222-8222-222222222222';
  o_priya  uuid := '22222222-0005-4222-8222-222222222222';
  o_tom    uuid := '22222222-0006-4222-8222-222222222222';

  -- Pets
  p_biscuit uuid := '33333333-0001-4333-8333-333333333333';
  p_luna    uuid := '33333333-0002-4333-8333-333333333333';
  p_cooper  uuid := '33333333-0003-4333-8333-333333333333';
  p_daisy   uuid := '33333333-0004-4333-8333-333333333333';
  p_rocky   uuid := '33333333-0005-4333-8333-333333333333';
  p_bella   uuid := '33333333-0006-4333-8333-333333333333';
  p_max     uuid := '33333333-0007-4333-8333-333333333333';
  p_pepper  uuid := '33333333-0008-4333-8333-333333333333';

  -- Suites
  s_a1   uuid := '55555555-0001-4555-8555-555555555555';
  s_a2   uuid := '55555555-0002-4555-8555-555555555555';
  s_b1   uuid := '55555555-0003-4555-8555-555555555555';
  s_pres uuid := '55555555-0004-4555-8555-555555555555';
BEGIN

  -- Cleanup previous reservation seed data
  DELETE FROM reservation_pets WHERE reservation_id IN (
    SELECT id FROM reservations WHERE notes LIKE '[seed]%' AND organization_id = org
  );
  DELETE FROM reservations WHERE notes LIKE '[seed]%' AND organization_id = org;

  -- Re-insert with timestamps relative to today
  INSERT INTO reservations
    (id, organization_id, location_id, service_id, primary_owner_id, suite_id, status, source,
     start_at, end_at, checked_in_at, requested_at, confirmed_at, notes)
  VALUES
    -- Coming In: Biscuit / Daycare / 8 AM → 6 PM
    ('44444444-0001-4444-8444-444444444444', org, loc, daycare, o_sarah, NULL, 'confirmed', 'staff_created',
     t + interval '8 hours', t + interval '18 hours', NULL,
     NOW() - interval '2 days', NOW() - interval '2 days', '[seed] Biscuit daycare'),

    -- Coming In: Cooper / Boarding / today 2 PM → in 2 days 5 PM
    ('44444444-0002-4444-8444-444444444444', org, loc, boarding, o_jenna, s_a1, 'confirmed', 'staff_created',
     t + interval '14 hours', t + interval '65 hours', NULL,
     NOW() - interval '3 days', NOW() - interval '3 days', '[seed] Cooper boarding'),

    -- Coming In: Daisy / Grooming / today 11 AM → 12:30 PM
    ('44444444-0003-4444-8444-444444444444', org, loc, grooming, o_alex, NULL, 'confirmed', 'staff_created',
     t + interval '11 hours', t + interval '12 hours 30 minutes', NULL,
     NOW() - interval '1 day', NOW() - interval '1 day', '[seed] Daisy grooming'),

    -- Coming In: Luna / Training / today 6 PM → 7 PM
    ('44444444-0004-4444-8444-444444444444', org, loc, training, o_mike, NULL, 'confirmed', 'staff_created',
     t + interval '18 hours', t + interval '19 hours', NULL,
     NOW() - interval '5 days', NOW() - interval '5 days', '[seed] Luna training class'),

    -- In The Pack / Going Home: Rocky / Daycare / sched 7 AM, in 7:30 AM, end 6 PM
    ('44444444-0005-4444-8444-444444444444', org, loc, daycare, o_priya, NULL, 'checked_in', 'staff_created',
     t + interval '7 hours', t + interval '18 hours',
     t + interval '7 hours 30 minutes',
     NOW() - interval '2 days', NOW() - interval '2 days', '[seed] Rocky daycare'),

    -- In The Pack / Going Home: Pepper / Daycare / sched 8 AM, in 8:15 AM, end 6 PM
    ('44444444-0006-4444-8444-444444444444', org, loc, daycare, o_jenna, NULL, 'checked_in', 'staff_created',
     t + interval '8 hours', t + interval '18 hours',
     t + interval '8 hours 15 minutes',
     NOW() - interval '2 days', NOW() - interval '2 days', '[seed] Pepper daycare'),

    -- In The Pack / Going Home: Max / Boarding / yesterday 5 PM → today 4 PM
    ('44444444-0007-4444-8444-444444444444', org, loc, boarding, o_sarah, s_a2, 'checked_in', 'staff_created',
     t - interval '7 hours', t + interval '16 hours',
     t - interval '7 hours',
     NOW() - interval '4 days', NOW() - interval '4 days', '[seed] Max boarding'),

    -- In The Pack / Sleeping Over: Bella / Boarding / 2 days ago 4 PM → in 2 days 5 PM
    ('44444444-0008-4444-8444-444444444444', org, loc, boarding, o_tom, s_b1, 'checked_in', 'staff_created',
     t - interval '32 hours', t + interval '65 hours',
     t - interval '32 hours',
     NOW() - interval '5 days', NOW() - interval '5 days', '[seed] Bella boarding multi-night'),

    -- Requests: Biscuit / Daycare / today 1 PM → 6 PM (same-day request)
    ('44444444-0009-4444-8444-444444444444', org, loc, daycare, o_sarah, NULL, 'requested', 'staff_created',
     t + interval '13 hours', t + interval '18 hours', NULL,
     NOW() - interval '1 hour', NULL, '[seed] Same-day Biscuit request'),

    -- Requests: Luna / Boarding / today 4 PM → in 3 days 5 PM
    ('44444444-0010-4444-8444-444444444444', org, loc, boarding, o_mike, s_pres, 'requested', 'staff_created',
     t + interval '16 hours', t + interval '89 hours', NULL,
     NOW() - interval '2 hours', NULL, '[seed] Luna boarding request');

  -- Re-link pets to reservations
  INSERT INTO reservation_pets (organization_id, reservation_id, pet_id) VALUES
    (org, '44444444-0001-4444-8444-444444444444', p_biscuit),
    (org, '44444444-0002-4444-8444-444444444444', p_cooper),
    (org, '44444444-0003-4444-8444-444444444444', p_daisy),
    (org, '44444444-0004-4444-8444-444444444444', p_luna),
    (org, '44444444-0005-4444-8444-444444444444', p_rocky),
    (org, '44444444-0006-4444-8444-444444444444', p_pepper),
    (org, '44444444-0007-4444-8444-444444444444', p_max),
    (org, '44444444-0008-4444-8444-444444444444', p_bella),
    (org, '44444444-0009-4444-8444-444444444444', p_biscuit),
    (org, '44444444-0010-4444-8444-444444444444', p_luna);

  -- Standard facility hours so the booking wizard's "Date and Time" defaults
  -- pull from real opens / closes instead of the legacy hardcoded values.
  -- Idempotent on (location_id, day_of_week).
  INSERT INTO location_hours (organization_id, location_id, day_of_week, open_time, close_time, closed) VALUES
    (org, loc, 0, '08:00', '17:00', false),
    (org, loc, 1, '07:00', '18:30', false),
    (org, loc, 2, '07:00', '18:30', false),
    (org, loc, 3, '07:00', '18:30', false),
    (org, loc, 4, '07:00', '18:30', false),
    (org, loc, 5, '07:00', '18:30', false),
    (org, loc, 6, '08:00', '17:00', false)
  ON CONFLICT (location_id, day_of_week) DO UPDATE
    SET open_time = EXCLUDED.open_time,
        close_time = EXCLUDED.close_time,
        closed = EXCLUDED.closed;

  -- Stagger confirmed_at 15 minutes after requested_at so the activity log
  -- shows the lifecycle in a sensible order (created, confirmed, checked_in).
  UPDATE reservations
     SET confirmed_at = requested_at + interval '15 minutes'
   WHERE notes LIKE '[seed]%'
     AND organization_id = org
     AND confirmed_at IS NOT NULL;

  -- Restore owner credits to a known starting state.
  -- The flat counter columns on owners are a denormalized cache maintained by
  -- the trigger on credit_ledger; we write ledger rows and let the trigger
  -- update the cache.
  DELETE FROM credit_ledger
   WHERE organization_id = org
     AND owner_id IN (o_sarah, o_mike, o_jenna, o_alex, o_priya, o_tom)
     AND note LIKE '[seed]%';

  INSERT INTO credit_ledger
    (organization_id, owner_id, kind, delta_full, delta_half, delta_nights, note, actor_kind, actor_label)
  VALUES
    (org, o_sarah, 'opening_balance', 12, 4, 5, '[seed] Sarah opening balance', 'system', 'System'),
    (org, o_mike,  'opening_balance',  8, 0, 0, '[seed] Mike opening balance',  'system', 'System'),
    (org, o_jenna, 'opening_balance',  0, 6, 3, '[seed] Jenna opening balance', 'system', 'System'),
    (org, o_alex,  'opening_balance', 20, 0, 10,'[seed] Alex opening balance',  'system', 'System'),
    (org, o_tom,   'opening_balance',  4, 2, 7, '[seed] Tom opening balance',   'system', 'System');
  -- Priya (o_priya) intentionally has no row: zero credits stays zero, and
  -- the credit_ledger CHECK constraint forbids all-zero rows.

  -- Activity log backfill for the seeded reservations.
  -- Wipe seed entries first (filter by entity_id list).
  DELETE FROM activity_log
   WHERE entity_type = 'reservation'
     AND entity_id IN (
       '44444444-0001-4444-8444-444444444444', '44444444-0002-4444-8444-444444444444',
       '44444444-0003-4444-8444-444444444444', '44444444-0004-4444-8444-444444444444',
       '44444444-0005-4444-8444-444444444444', '44444444-0006-4444-8444-444444444444',
       '44444444-0007-4444-8444-444444444444', '44444444-0008-4444-8444-444444444444',
       '44444444-0009-4444-8444-444444444444', '44444444-0010-4444-8444-444444444444'
     );

  -- "created" event for every seed reservation, matching its requested_at.
  -- Pending requests log as "by Owner"; staff-created bookings as "by Smoke Tester".
  INSERT INTO activity_log (organization_id, actor_id, action, entity_type, entity_id, metadata, created_at)
  SELECT
    org, NULL, 'created', 'reservation', r.id,
    jsonb_build_object(
      'actor_kind', CASE WHEN r.status = 'requested' THEN 'owner' ELSE 'staff' END,
      'actor_label', CASE WHEN r.status = 'requested' THEN 'Owner' ELSE 'Smoke Tester' END,
      'source', r.source::text
    ),
    r.requested_at
  FROM reservations r
  WHERE r.notes LIKE '[seed]%' AND r.organization_id = org;

  -- "confirmed" event for confirmed + checked_in reservations.
  INSERT INTO activity_log (organization_id, actor_id, action, entity_type, entity_id, metadata, created_at)
  SELECT
    org, NULL, 'confirmed', 'reservation', r.id,
    jsonb_build_object('actor_kind', 'staff', 'actor_label', 'Smoke Tester'),
    r.confirmed_at
  FROM reservations r
  WHERE r.notes LIKE '[seed]%'
    AND r.organization_id = org
    AND r.confirmed_at IS NOT NULL;

  -- "checked_in" event for currently-checked-in reservations.
  INSERT INTO activity_log (organization_id, actor_id, action, entity_type, entity_id, metadata, created_at)
  SELECT
    org, NULL, 'checked_in', 'reservation', r.id,
    jsonb_build_object('actor_kind', 'staff', 'actor_label', 'Smoke Tester'),
    r.checked_in_at
  FROM reservations r
  WHERE r.notes LIKE '[seed]%'
    AND r.organization_id = org
    AND r.checked_in_at IS NOT NULL;

END $$;
