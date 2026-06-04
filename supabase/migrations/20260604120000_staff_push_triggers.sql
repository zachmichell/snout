-- Staff push notification triggers
--
-- Fires APNs pushes to the Snout Staff iOS app on four event categories:
--   1. new owner self-serve booking request   (reservations INSERT)
--   2. new client message                     (messages INSERT, sender_type='owner')
--   3. new grooming appointment assigned      (grooming_appointments INSERT/UPDATE)
--   4. new class assigned to a trainer        (class_instances INSERT/UPDATE)
--   5. new incident logged                    (incidents INSERT)
--
-- Counting grooming+class as one logical "assignment" category gives us the
-- "4 events" called out in the staff-push spec; under the hood they need
-- separate per-table triggers.
--
-- All trigger functions are SECURITY DEFINER and wrap the dispatch in a
-- catch-all exception block so a transient pg_net / vault failure can never
-- roll back the original INSERT. If the APNs key isn't configured yet, the
-- edge function itself returns 503 — the trigger fired but nothing was sent.
--
-- The helper uses the same pg_net + vault.decrypted_secrets pattern as
-- invoke_send_reservation_reminders (see PR #X).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Dispatcher: post a payload to the send-staff-push edge function.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.send_staff_push(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions', 'net'
as $$
declare
  _key  text;
  _base text := 'https://empdnuzfjgfnphwauhah.supabase.co/functions/v1';
begin
  select decrypted_secret into _key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if _key is null then
    raise notice 'send_staff_push: service_role_key not in vault; skipping';
    return;
  end if;

  perform net.http_post(
    url     := _base || '/send-staff-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _key,
      'Content-Type',  'application/json'
    ),
    body    := p_payload,
    timeout_milliseconds := 30000
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. New booking request (owner self-serve only).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_staff_push_booking_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _owner_name   text;
  _service_name text;
  _when_str     text;
begin
  -- Owner-initiated requested bookings only. Staff-created reservations
  -- don't need a push back to the staff who created them.
  if new.source is distinct from 'owner_self_serve'
     or new.status is distinct from 'requested' then
    return new;
  end if;

  select coalesce(nullif(trim(o.first_name), ''), 'A customer')
    into _owner_name
    from owners o
   where o.id = new.primary_owner_id;

  select coalesce(s.name, 'a service')
    into _service_name
    from services s
   where s.id = new.service_id;

  _when_str := to_char(new.start_at, 'Mon DD, HH24:MI');

  perform public.send_staff_push(jsonb_build_object(
    'organization_id', new.organization_id,
    'roles',           jsonb_build_array('owner', 'admin', 'manager'),
    'title',           'New booking request',
    'body',            format('%s requested %s — %s',
                              coalesce(_owner_name, 'A customer'),
                              coalesce(_service_name, 'a service'),
                              _when_str),
    'thread_id',       'booking-' || new.id::text,
    'category',        'BOOKING_REQUEST',
    'data', jsonb_build_object(
      'kind',            'booking_request',
      'reservation_id',  new.id,
      'organization_id', new.organization_id
    )
  ));

  return new;
exception when others then
  raise notice 'trg_staff_push_booking_request: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists staff_push_booking_request on public.reservations;
create trigger staff_push_booking_request
  after insert on public.reservations
  for each row execute function public.trg_staff_push_booking_request();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. New client message (from owner → staff).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_staff_push_new_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _conv          conversations%rowtype;
  _owner_name    text;
  _preview       text;
begin
  -- Only the owner→staff direction goes to APNs. Staff→owner is handled by
  -- the existing web-push send-push-notification path.
  if new.sender_type is distinct from 'owner' then
    return new;
  end if;

  select * into _conv
    from conversations
   where id = new.conversation_id;

  if _conv.id is null then
    return new;
  end if;

  select coalesce(nullif(trim(o.first_name), ''), 'A customer')
    into _owner_name
    from owners o
   where o.id = _conv.owner_id;

  -- Trim/clip the body to a sensible APNs alert size.
  _preview := coalesce(new.body, '');
  if length(_preview) > 140 then
    _preview := substring(_preview, 1, 137) || '...';
  end if;
  if _preview = '' then
    _preview := 'Sent an attachment';
  end if;

  perform public.send_staff_push(jsonb_build_object(
    'organization_id', _conv.organization_id,
    'title',           format('Message from %s', _owner_name),
    'body',            _preview,
    'thread_id',       'conversation-' || _conv.id::text,
    'category',        'CLIENT_MESSAGE',
    'data', jsonb_build_object(
      'kind',            'client_message',
      'conversation_id', _conv.id,
      'message_id',      new.id,
      'organization_id', _conv.organization_id
    )
  ));

  return new;
exception when others then
  raise notice 'trg_staff_push_new_message: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists staff_push_new_message on public.messages;
create trigger staff_push_new_message
  after insert on public.messages
  for each row execute function public.trg_staff_push_new_message();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Grooming appointment assigned to a groomer.
--    Fires when groomer_id transitions from null → non-null (assignment),
--    or when a new row is inserted that already has a groomer.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_staff_push_grooming_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _is_new_assignment boolean;
  _groomer_profile   uuid;
  _pet_name          text;
  _when_str          text;
begin
  if tg_op = 'INSERT' then
    _is_new_assignment := new.groomer_id is not null;
  else
    _is_new_assignment := new.groomer_id is not null
      and (old.groomer_id is distinct from new.groomer_id);
  end if;

  if not _is_new_assignment then
    return new;
  end if;

  -- grooming_appointments.groomer_id → groomers.id; staff-app device_tokens
  -- are keyed by profile_id, so resolve through groomers.staff_member_id
  -- (the profile linkage added in the trainer-role migration).
  select g.staff_member_id into _groomer_profile
    from groomers g
   where g.id = new.groomer_id;

  if _groomer_profile is null then
    -- Groomer record exists but isn't linked to a profile yet — nothing
    -- to push to. The web staff dashboard will still show the assignment.
    return new;
  end if;

  select coalesce(p.name, 'A pet') into _pet_name
    from pets p
   where p.id = new.pet_id;

  _when_str := to_char(
    (new.appointment_date::timestamp + coalesce(new.start_time, '00:00'::time)),
    'Mon DD, HH24:MI'
  );

  perform public.send_staff_push(jsonb_build_object(
    'profile_ids',     jsonb_build_array(_groomer_profile),
    'title',           'New grooming appointment',
    'body',            format('%s — %s', _pet_name, _when_str),
    'thread_id',       'grooming-' || new.id::text,
    'category',        'GROOMING_ASSIGNED',
    'data', jsonb_build_object(
      'kind',            'grooming_assigned',
      'appointment_id',  new.id,
      'organization_id', new.organization_id
    )
  ));

  return new;
exception when others then
  raise notice 'trg_staff_push_grooming_assigned: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists staff_push_grooming_assigned on public.grooming_appointments;
create trigger staff_push_grooming_assigned
  after insert or update of groomer_id on public.grooming_appointments
  for each row execute function public.trg_staff_push_grooming_assigned();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Class assigned to an instructor (trainer).
--    class_instances.instructor_user_id already points at a profile.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_staff_push_class_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _is_new_assignment boolean;
  _class_name        text;
  _when_str          text;
begin
  if tg_op = 'INSERT' then
    _is_new_assignment := new.instructor_user_id is not null;
  else
    _is_new_assignment := new.instructor_user_id is not null
      and (old.instructor_user_id is distinct from new.instructor_user_id);
  end if;

  if not _is_new_assignment then
    return new;
  end if;

  select coalesce(ct.name, 'a class') into _class_name
    from class_types ct
   where ct.id = new.class_type_id;

  _when_str := to_char(new.start_at, 'Mon DD, HH24:MI');

  perform public.send_staff_push(jsonb_build_object(
    'profile_ids',     jsonb_build_array(new.instructor_user_id),
    'title',           'New class assigned',
    'body',            format('%s — %s', _class_name, _when_str),
    'thread_id',       'class-' || new.id::text,
    'category',        'CLASS_ASSIGNED',
    'data', jsonb_build_object(
      'kind',            'class_assigned',
      'instance_id',     new.id,
      'organization_id', new.organization_id
    )
  ));

  return new;
exception when others then
  raise notice 'trg_staff_push_class_assigned: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists staff_push_class_assigned on public.class_instances;
create trigger staff_push_class_assigned
  after insert or update of instructor_user_id on public.class_instances
  for each row execute function public.trg_staff_push_class_assigned();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Incident logged.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_staff_push_incident()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _location_name text;
  _severity      text;
begin
  select coalesce(l.name, 'a location') into _location_name
    from locations l
   where l.id = new.location_id;

  _severity := coalesce(new.severity, 'unspecified');

  perform public.send_staff_push(jsonb_build_object(
    'organization_id',     new.organization_id,
    'roles',               jsonb_build_array('owner', 'admin', 'manager'),
    'exclude_profile_id',  new.reported_by,  -- the reporter doesn't need a push back to themselves
    'title',               format('Incident reported (%s)', _severity),
    'body',                format('%s — %s', coalesce(new.incident_type, 'incident'), _location_name),
    'thread_id',           'incident-' || new.id::text,
    'category',            'INCIDENT',
    'data', jsonb_build_object(
      'kind',            'incident',
      'incident_id',     new.id,
      'organization_id', new.organization_id,
      'severity',        _severity
    )
  ));

  return new;
exception when others then
  raise notice 'trg_staff_push_incident: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists staff_push_incident on public.incidents;
create trigger staff_push_incident
  after insert on public.incidents
  for each row execute function public.trg_staff_push_incident();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Lock down the dispatcher.
--
-- public.send_staff_push reaches into vault.decrypted_secrets and posts to
-- an internal edge function. It's only meant to be called by the trigger
-- functions above (which are SECURITY DEFINER and run as their owner) or
-- by maintenance scripts as postgres / service_role. Strip the default
-- PUBLIC grant so anon/authenticated code can't fan out arbitrary pushes.
-- ─────────────────────────────────────────────────────────────────────────

revoke execute on function public.send_staff_push(jsonb) from public;
grant  execute on function public.send_staff_push(jsonb) to postgres, service_role;

