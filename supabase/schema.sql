-- =============================================================================
-- WheelOfTest — Supabase schema
-- Paste into the Supabase SQL editor and run once. Safe to re-run: tables use
-- IF NOT EXISTS, functions are replaced, policies and grants are re-applied.
--
-- Clients (anonymous sign-in users hold the `authenticated` role) can:
--   * SELECT rows of rooms they are a member of (RLS),
--   * EXECUTE the six RPCs below.
-- Nothing else. All writes go through the RPCs, which take identity from
-- auth.uid() and never from a parameter.
--
-- Upgrading from the version without editable tasks: just run this file again.
-- Existing rooms keep their stored tasks; the old task shape (platform/device)
-- is still understood everywhere, so old rooms behave exactly as before.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Constants. Keep in sync with config.js (roomCapacity, complaintThreshold).
-- -----------------------------------------------------------------------------
create or replace function public.wot_room_capacity()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;

create or replace function public.wot_complaint_threshold()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.rooms (
  id            uuid        primary key default gen_random_uuid(),
  code          text        not null unique
                            check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  host_user_id  uuid        not null references auth.users (id) on delete cascade,
  status        text        not null default 'lobby'
                            check (status in ('lobby', 'spun', 'final')),
  spins_used    smallint    not null default 0 check (spins_used between 0 and 2),
  state_version integer     not null default 1 check (state_version >= 1),
  tasks         jsonb       not null check (jsonb_typeof(tasks) = 'array'),
  created_at    timestamptz not null default now(),
  constraint rooms_status_matches_spins check (
       (status = 'lobby' and spins_used = 0)
    or (status = 'spun'  and spins_used = 1)
    or (status = 'final' and spins_used = 2)
  )
);

create table if not exists public.participants (
  room_id   uuid        not null references public.rooms (id) on delete cascade,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  name      text        not null check (char_length(name) between 1 and 40 and name !~ '^\s|\s$'),
  team      text        not null check (team in ('AF', 'CYD', 'PB')),
  mac       boolean     not null default false,
  android   boolean     not null default false,
  ios       boolean     not null default false,
  joined_at timestamptz not null default now(),
  constraint participants_pkey primary key (room_id, user_id)  -- one row per person per room
);
-- Added with Mac support; existing rows get false. (Everyone has Desktop, so it isn't stored.)
alter table public.participants add column if not exists mac boolean not null default false;

create table if not exists public.spins (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references public.rooms (id) on delete cascade,
  spin_number smallint    not null check (spin_number in (1, 2)),
  assignments jsonb       not null check (jsonb_typeof(assignments) = 'array'),
  created_at  timestamptz not null default now(),
  constraint spins_one_per_number unique (room_id, spin_number)
);

create table if not exists public.complaints (
  room_id    uuid        not null,
  user_id    uuid        not null,
  created_at timestamptz not null default now(),
  constraint complaints_pkey primary key (room_id, user_id),   -- one complaint per person per room
  constraint complaints_by_member foreign key (room_id, user_id)
    references public.participants (room_id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- -----------------------------------------------------------------------------
create or replace function public._wot_fail(p_message text, p_hint text, p_errcode text default 'P0001')
returns void language plpgsql volatile set search_path = '' as $$
begin
  raise exception using message = p_message, hint = p_hint, errcode = p_errcode;
end $$;

create or replace function public._wot_normalize_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_code is null or length(p_code) > 32 then null
    when upper(btrim(p_code)) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then upper(btrim(p_code))
    else null
  end
$$;

create or replace function public._wot_random_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());  -- bytes 0..5 of a v4 UUID are random
  v_code text := '';
begin
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  return v_code;
end $$;

create or replace function public._wot_clean_profile(p_profile jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_name text;
  v_team text;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or length(p_profile::text) > 1000 then
    perform public._wot_fail('Profile is missing or malformed.', 'invalid_profile', '22023');
  end if;
  if jsonb_typeof(p_profile -> 'name') is distinct from 'string' then
    perform public._wot_fail('Enter your name.', 'invalid_profile', '22023');
  end if;
  v_name := regexp_replace(p_profile ->> 'name', '^\s+|\s+$', '', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    perform public._wot_fail('Name must be 1 to 40 characters.', 'invalid_profile', '22023');
  end if;
  if v_name ~ '[\x01-\x1F\x7F]' then
    perform public._wot_fail('Name contains characters that are not allowed.', 'invalid_profile', '22023');
  end if;
  v_team := p_profile ->> 'team';
  if jsonb_typeof(p_profile -> 'team') is distinct from 'string' or v_team not in ('AF', 'CYD', 'PB') then
    perform public._wot_fail('Team must be AF, CYD or PB.', 'invalid_profile', '22023');
  end if;
  if coalesce(jsonb_typeof(p_profile -> 'mac'), 'boolean') <> 'boolean'
     or coalesce(jsonb_typeof(p_profile -> 'android'), 'boolean') <> 'boolean'
     or coalesce(jsonb_typeof(p_profile -> 'ios'), 'boolean') <> 'boolean' then
    perform public._wot_fail('Devices must be true or false.', 'invalid_profile', '22023');
  end if;
  return jsonb_build_object(
    'name', v_name,
    'team', v_team,
    'mac', coalesce((p_profile ->> 'mac')::boolean, false),
    'android', coalesce((p_profile ->> 'android')::boolean, false),
    'ios', coalesce((p_profile ->> 'ios')::boolean, false)
  );
end $$;

-- True when p_list is a JSON array of p_min..p_max distinct strings (1-40 chars each),
-- all from p_allowed when that is given.
create or replace function public._wot_is_string_list(p_list jsonb, p_min integer, p_max integer, p_allowed text[] default null)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_list is null or jsonb_typeof(p_list) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_list) not between p_min and p_max then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_list) e
    where jsonb_typeof(e) <> 'string'
       or char_length(e #>> '{}') not between 1 and 40
       or (p_allowed is not null and (e #>> '{}') <> all (p_allowed))
  ) then
    return false;
  end if;
  return (select count(distinct e) from jsonb_array_elements(p_list) e) = jsonb_array_length(p_list);
end $$;

-- A room's task list (1-50 tasks). Shape of one task:
--   { id, what, theme, team: 'AF'|'CYD'|'PB'|null, devices: ['desktop'|'mac'|'android'|'ios', ...] (1+),
--     browsers: [text] (0-10, for Desktop; Mac means Safari), users: [text] (0-10) }
-- Keep the limits equal to maxTasks and taskNameMaxLength in config.js.
create or replace function public._wot_clean_tasks(p_tasks jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_task jsonb;
  v_what text;
  v_ids text[] := '{}';
  v_out jsonb := '[]'::jsonb;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or length(p_tasks::text) > 60000 then
    perform public._wot_fail('Task list is missing or too large.', 'invalid_tasks', '22023');
  end if;
  if jsonb_array_length(p_tasks) not between 1 and 50 then
    perform public._wot_fail('A room needs 1 to 50 tasks.', 'invalid_tasks', '22023');
  end if;
  for v_task in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(v_task) <> 'object'
       or jsonb_typeof(v_task -> 'id') is distinct from 'string'
       or char_length(v_task ->> 'id') not between 1 and 64
       or jsonb_typeof(v_task -> 'what') is distinct from 'string'
       or jsonb_typeof(v_task -> 'theme') is distinct from 'string'
       or char_length(v_task ->> 'theme') not between 1 and 40
       or coalesce(jsonb_typeof(v_task -> 'team'), 'null') not in ('null', 'string')
       or (v_task ->> 'team') not in ('AF', 'CYD', 'PB')
       or not public._wot_is_string_list(v_task -> 'devices', 1, 4, array['desktop', 'mac', 'android', 'ios'])
       or not public._wot_is_string_list(coalesce(v_task -> 'browsers', '[]'::jsonb), 0, 10)
       or not public._wot_is_string_list(coalesce(v_task -> 'users', '[]'::jsonb), 0, 10)
    then
      perform public._wot_fail('A task is malformed.', 'invalid_tasks', '22023');
    end if;
    v_what := regexp_replace(v_task ->> 'what', '^\s+|\s+$', '', 'g');
    if char_length(v_what) not between 1 and 60 or v_what ~ '[\x01-\x1F\x7F]' then
      perform public._wot_fail('Every task needs a name of 1 to 60 characters.', 'invalid_tasks', '22023');
    end if;
    if (v_task ->> 'id') = any (v_ids) then
      perform public._wot_fail('Task ids must be unique.', 'invalid_tasks', '22023');
    end if;
    v_ids := v_ids || (v_task ->> 'id');
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', v_task -> 'id', 'what', to_jsonb(v_what), 'theme', v_task -> 'theme',
      'team', coalesce(v_task -> 'team', 'null'::jsonb),
      'devices', v_task -> 'devices',
      'browsers', coalesce(v_task -> 'browsers', '[]'::jsonb),
      'users', coalesce(v_task -> 'users', '[]'::jsonb)));
  end loop;
  return v_out;
end $$;

-- The phones a task needs; the assignee must have at least one. Empty = no phone needed.
-- Also reads the pre-editor shape (platform 'mobile' meant either phone).
create or replace function public._wot_task_phones(p_task jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_task -> 'devices') = 'array' then
      array(select ph from unnest(array['android', 'ios']) with ordinality as x(ph, ord)
            where (p_task -> 'devices') ? ph order by ord)
    when (p_task ->> 'platform') = 'mobile' then array['android', 'ios']
    else '{}'::text[]
  end
$$;

-- Whether a task needs a tester with a Mac (old-shape tasks never do).
create or replace function public._wot_task_needs_mac(p_task jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_task -> 'devices') = 'array' and (p_task -> 'devices') ? 'mac', false)
$$;

-- Same text as unassignedReason() in domain.js, e.g. "No one online has a Mac and an iOS phone."
drop function if exists public._wot_unassigned_reason(text[]);  -- replaced by the version with p_mac
create or replace function public._wot_unassigned_reason(p_phones text[], p_mac boolean)
returns text language sql immutable set search_path = '' as $$
  select 'No one online has '
    || concat_ws(' and ',
         case when coalesce(p_mac, false) then 'a Mac' end,
         case when cardinality(p_phones) > 0 or not coalesce(p_mac, false) then
           'an ' || array_to_string(array(
             select case ph when 'android' then 'Android' else 'iOS' end
             from unnest(case when cardinality(p_phones) > 0 then p_phones else array['android', 'ios'] end)
                  with ordinality as x(ph, ord)
             order by ord), ' or ') || ' phone'
         end)
    || '.'
$$;

-- The full room state a member sees. Called only from the RPCs below.
create or replace function public._wot_snapshot(p_room_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'exists', true,
    'member', true,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'host_user_id', r.host_user_id, 'status', r.status,
      'spins_used', r.spins_used, 'state_version', r.state_version, 'tasks', r.tasks,
      'created_at', r.created_at),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'name', p.name, 'team', p.team,
               'mac', p.mac, 'android', p.android, 'ios', p.ios, 'joined_at', p.joined_at)
             order by p.joined_at, p.user_id)
      from public.participants p where p.room_id = r.id), '[]'::jsonb),
    'spins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'spin_number', s.spin_number, 'assignments', s.assignments, 'created_at', s.created_at)
             order by s.spin_number)
      from public.spins s where s.room_id = r.id), '[]'::jsonb),
    'complaints', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'created_at', c.created_at)
             order by c.created_at, c.user_id)
      from public.complaints c where c.room_id = r.id), '[]'::jsonb)
  )
  from public.rooms r
  where r.id = p_room_id
$$;

-- Used by RLS policies. SECURITY DEFINER so the participants policy does not recurse.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participants
    where room_id = p_room_id and user_id = (select auth.uid())
  )
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function public.create_room(p_profile jsonb, p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_tasks jsonb;
  v_room_id uuid;
  v_attempt integer := 0;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  v_profile := public._wot_clean_profile(p_profile);
  v_tasks := public._wot_clean_tasks(p_tasks);

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.rooms (code, host_user_id, tasks)
      values (public._wot_random_code(), v_uid, v_tasks)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        perform public._wot_fail('Could not generate a unique room code. Try again.', 'code_collision');
      end if;
    end;
  end loop;

  insert into public.participants (room_id, user_id, name, team, mac, android, ios)
  values (v_room_id, v_uid, v_profile ->> 'name', v_profile ->> 'team', (v_profile ->> 'mac')::boolean,
          (v_profile ->> 'android')::boolean, (v_profile ->> 'ios')::boolean);

  return public._wot_snapshot(v_room_id);
end $$;

create or replace function public.join_room(p_code text, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_room public.rooms%rowtype;
  v_count integer;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  v_profile := public._wot_clean_profile(p_profile);

  select * into v_room from public.rooms
  where code = public._wot_normalize_code(p_code)
  for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;

  if not exists (select 1 from public.participants where room_id = v_room.id and user_id = v_uid) then
    select count(*) into v_count from public.participants where room_id = v_room.id;
    if v_count >= public.wot_room_capacity() then
      perform public._wot_fail(format('This room is full (%s people).', public.wot_room_capacity()), 'room_full');
    end if;
  end if;

  insert into public.participants (room_id, user_id, name, team, mac, android, ios)
  values (v_room.id, v_uid, v_profile ->> 'name', v_profile ->> 'team', (v_profile ->> 'mac')::boolean,
          (v_profile ->> 'android')::boolean, (v_profile ->> 'ios')::boolean)
  on conflict (room_id, user_id) do update
    set name = excluded.name, team = excluded.team,
        mac = excluded.mac, android = excluded.android, ios = excluded.ios;

  update public.rooms set state_version = state_version + 1 where id = v_room.id;
  return public._wot_snapshot(v_room.id);
end $$;

create or replace function public.get_room(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select id into v_room_id from public.rooms where code = public._wot_normalize_code(p_code);
  if v_room_id is null then
    return jsonb_build_object('exists', false, 'member', false);
  end if;
  if not exists (select 1 from public.participants where room_id = v_room_id and user_id = v_uid) then
    return jsonb_build_object('exists', true, 'member', false);
  end if;
  return public._wot_snapshot(v_room_id);
end $$;

create or replace function public.commit_spin(p_room_id uuid, p_spin_number integer, p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_task_count integer;
  v_stored jsonb;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;

  -- Who and when
  if v_room.host_user_id <> v_uid then
    perform public._wot_fail('Only the moderator can spin.', 'not_host', '42501');
  end if;
  if v_room.status = 'final' or v_room.spins_used >= 2 then
    perform public._wot_fail('The result is final. No more spins.', 'spin_not_allowed');
  end if;
  if p_spin_number is null or p_spin_number <> v_room.spins_used + 1 or p_spin_number > 2 then
    perform public._wot_fail('That spin is out of date. The room has been refreshed.', 'stale_spin');
  end if;
  if p_spin_number = 2
     and (select count(*) from public.complaints where room_id = p_room_id) < public.wot_complaint_threshold() then
    perform public._wot_fail(
      format('A second spin needs at least %s complaints.', public.wot_complaint_threshold()), 'spin_not_allowed');
  end if;

  -- Shape
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' or length(p_assignments::text) > 200000 then
    perform public._wot_fail('Assignments are missing or too large.', 'invalid_assignments', '22023');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'task_id') is distinct from 'string'
       or coalesce(jsonb_typeof(e -> 'participant_id'), 'null') not in ('string', 'null')
  ) then
    perform public._wot_fail('Assignments are malformed.', 'invalid_assignments', '22023');
  end if;

  -- Every task in the room exactly once. A mismatch usually means the moderator changed
  -- the tasks in another tab, so the client is told to re-fetch.
  v_task_count := jsonb_array_length(v_room.tasks);
  if jsonb_array_length(p_assignments) <> v_task_count
     or (select count(distinct e ->> 'task_id')
         from jsonb_array_elements(p_assignments) e
         where (e ->> 'task_id') in (select t ->> 'id' from jsonb_array_elements(v_room.tasks) t)
        ) <> v_task_count then
    perform public._wot_fail('The task list changed. The room has been refreshed, so spin again.', 'stale_spin');
  end if;
  -- ...and the client assigned the tasks as they are stored now (an edit can keep the id).
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    where public._wot_task_phones(e -> 'task') is distinct from public._wot_task_phones(t)
       or public._wot_task_needs_mac(e -> 'task') is distinct from public._wot_task_needs_mac(t)
       or (e -> 'task' ->> 'team') is distinct from (t ->> 'team')
  ) then
    perform public._wot_fail('The task list changed. The room has been refreshed, so spin again.', 'stale_spin');
  end if;

  -- Every assignee is a member of this room
  if exists (
    select 1 from jsonb_array_elements(p_assignments) e
    where (e ->> 'participant_id') is not null
      and not exists (select 1 from public.participants p
                      where p.room_id = p_room_id and p.user_id::text = (e ->> 'participant_id'))
  ) then
    perform public._wot_fail('Tasks can only go to people in this room.', 'invalid_assignments', '22023');
  end if;

  -- Device rule: a Mac task goes only to someone with a Mac; a phone task only to someone
  -- with one of the selected phones; a task with both needs both.
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    join public.participants p on p.room_id = p_room_id and p.user_id::text = (e ->> 'participant_id')
    cross join lateral (select public._wot_task_phones(t) as phones, public._wot_task_needs_mac(t) as mac) x
    where (x.mac and not p.mac)
       or (cardinality(x.phones) > 0
           and not ((p.android and 'android' = any (x.phones)) or (p.ios and 'ios' = any (x.phones))))
  ) then
    perform public._wot_fail('A task went to someone without the Mac or phone it needs.', 'invalid_assignments', '22023');
  end if;

  -- Desktop-only tasks can always be assigned (the moderator is online), so they may not be left empty
  if exists (
    select 1
    from jsonb_array_elements(p_assignments) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    where (e ->> 'participant_id') is null
      and cardinality(public._wot_task_phones(t)) = 0 and not public._wot_task_needs_mac(t)
  ) then
    perform public._wot_fail('Tasks that need no Mac or phone cannot be left unassigned.', 'invalid_assignments', '22023');
  end if;

  -- Store what the database knows, not the client's copies of names or tasks
  select jsonb_agg(jsonb_build_object(
           'task_id', t.task ->> 'id',
           'task', t.task,
           'participant_id', p.user_id,
           'participant', case when p.user_id is null then null else
             jsonb_build_object('name', p.name, 'team', p.team, 'mac', p.mac, 'android', p.android, 'ios', p.ios) end,
           'team_match', case when p.user_id is null or (t.task ->> 'team') is null then null
                              else p.team = (t.task ->> 'team') end,
           'reason', case when p.user_id is null
                          then public._wot_unassigned_reason(public._wot_task_phones(t.task),
                                                             public._wot_task_needs_mac(t.task)) end
         ) order by t.ord)
  into v_stored
  from jsonb_array_elements(v_room.tasks) with ordinality as t(task, ord)
  join jsonb_array_elements(p_assignments) e on (e ->> 'task_id') = (t.task ->> 'id')
  left join public.participants p on p.room_id = p_room_id and p.user_id::text = (e ->> 'participant_id');

  insert into public.spins (room_id, spin_number, assignments)
  values (p_room_id, p_spin_number, v_stored);

  update public.rooms
  set spins_used = p_spin_number,
      status = case when p_spin_number = 1 then 'spun' else 'final' end,
      state_version = state_version + 1
  where id = p_room_id;

  return public._wot_snapshot(p_room_id);
end $$;

create or replace function public.complain(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  if not exists (select 1 from public.participants where room_id = p_room_id and user_id = v_uid) then
    perform public._wot_fail('Only people in this room can complain.', 'not_member', '42501');
  end if;
  if v_room.status = 'lobby' then
    perform public._wot_fail('You can complain only after the first spin.', 'complaints_closed');
  end if;
  if v_room.status = 'final' then
    perform public._wot_fail('The result is final. Complaints are closed.', 'complaints_closed');
  end if;

  insert into public.complaints (room_id, user_id) values (p_room_id, v_uid)
  on conflict (room_id, user_id) do nothing;  -- idempotent: a repeat complaint changes nothing
  update public.rooms set state_version = state_version + 1 where id = p_room_id;

  return public._wot_snapshot(p_room_id);
end $$;

-- Replace the room's task list. Moderator only, and only before the first spin.
-- Locks the room row like commit_spin, so an edit and a spin never interleave.
create or replace function public.update_tasks(p_room_id uuid, p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_tasks jsonb;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  if v_room.host_user_id <> v_uid then
    perform public._wot_fail('Only the moderator can change the tasks.', 'not_host', '42501');
  end if;
  if v_room.status <> 'lobby' or v_room.spins_used <> 0 then
    perform public._wot_fail('The wheel has already spun, so the tasks can no longer change.', 'tasks_locked');
  end if;

  v_tasks := public._wot_clean_tasks(p_tasks);
  update public.rooms
  set tasks = v_tasks, state_version = state_version + 1
  where id = p_room_id;

  return public._wot_snapshot(p_room_id);
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security: members may read their room; nobody writes directly.
-- -----------------------------------------------------------------------------
alter table public.rooms        enable row level security;
alter table public.participants enable row level security;
alter table public.spins        enable row level security;
alter table public.complaints   enable row level security;

drop policy if exists "members read rooms" on public.rooms;
create policy "members read rooms" on public.rooms
  for select to authenticated using (public.is_room_member(id));

drop policy if exists "members read participants" on public.participants;
create policy "members read participants" on public.participants
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "members read spins" on public.spins;
create policy "members read spins" on public.spins
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "members read complaints" on public.complaints;
create policy "members read complaints" on public.complaints
  for select to authenticated using (public.is_room_member(room_id));

-- -----------------------------------------------------------------------------
-- Grants. Supabase grants ALL on new public tables/functions to anon and
-- authenticated by default, so revoke explicitly, then grant the minimum.
-- -----------------------------------------------------------------------------
revoke all on table public.rooms, public.participants, public.spins, public.complaints
  from public, anon, authenticated;
grant select on table public.rooms, public.participants, public.spins, public.complaints
  to authenticated;

revoke all on function public.wot_room_capacity()               from public, anon, authenticated;
revoke all on function public.wot_complaint_threshold()         from public, anon, authenticated;
revoke all on function public._wot_fail(text, text, text)       from public, anon, authenticated;
revoke all on function public._wot_normalize_code(text)         from public, anon, authenticated;
revoke all on function public._wot_random_code()                from public, anon, authenticated;
revoke all on function public._wot_clean_profile(jsonb)         from public, anon, authenticated;
revoke all on function public._wot_clean_tasks(jsonb)           from public, anon, authenticated;
revoke all on function public._wot_is_string_list(jsonb, integer, integer, text[]) from public, anon, authenticated;
revoke all on function public._wot_task_phones(jsonb)           from public, anon, authenticated;
revoke all on function public._wot_task_needs_mac(jsonb)        from public, anon, authenticated;
revoke all on function public._wot_unassigned_reason(text[], boolean) from public, anon, authenticated;
revoke all on function public._wot_snapshot(uuid)               from public, anon, authenticated;

revoke all on function public.is_room_member(uuid)              from public, anon, authenticated;
grant execute on function public.is_room_member(uuid)           to authenticated;  -- needed by RLS

revoke all on function public.create_room(jsonb, jsonb)                 from public, anon, authenticated;
revoke all on function public.join_room(text, jsonb)                    from public, anon, authenticated;
revoke all on function public.get_room(text)                            from public, anon, authenticated;
revoke all on function public.commit_spin(uuid, integer, jsonb)         from public, anon, authenticated;
revoke all on function public.complain(uuid)                            from public, anon, authenticated;
revoke all on function public.update_tasks(uuid, jsonb)                 from public, anon, authenticated;
grant execute on function public.create_room(jsonb, jsonb)              to authenticated;
grant execute on function public.join_room(text, jsonb)                 to authenticated;
grant execute on function public.get_room(text)                         to authenticated;
grant execute on function public.commit_spin(uuid, integer, jsonb)      to authenticated;
grant execute on function public.complain(uuid)                         to authenticated;
grant execute on function public.update_tasks(uuid, jsonb)              to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: every RPC bumps rooms.state_version, so one UPDATE event per change.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;