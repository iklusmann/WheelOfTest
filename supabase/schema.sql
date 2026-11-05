-- =============================================================================
-- WheelOfTest — Supabase schema
-- Paste into the Supabase SQL editor and run once. Safe to re-run: tables use
-- IF NOT EXISTS, functions are replaced, policies and grants are re-applied.
--
-- Clients (anonymous sign-in users hold the `authenticated` role) can:
--   * SELECT rows of rooms they are a member of (RLS),
--   * EXECUTE the fourteen RPCs below.
-- Nothing else. All writes go through the RPCs, which take identity from
-- auth.uid() and never from a parameter.
--
-- Upgrading from an earlier version: just run this file again. It adds the
-- takeover_requests table and its RPCs, the per-room settings (tasks per person, session
-- links), several testers per task and the moderator's post-spin task changes. Spins stored
-- before several testers per task (participant_id) are read in place and converted when
-- they are next written. Existing rooms keep their stored
-- tasks; the old task shape (platform/device) is still understood everywhere,
-- so old rooms behave exactly as before.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Constants. Keep in sync with config.js (roomCapacity, complaintThreshold, ...).
-- -----------------------------------------------------------------------------
create or replace function public.wot_room_capacity()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;

create or replace function public.wot_complaint_threshold()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;

-- How many takeover requests one person may have waiting at the same time (maxPendingRequests in config.js).
create or replace function public.wot_max_pending_requests()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;

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

-- Added with per-room settings. Existing rooms keep one task per person and no links.
alter table public.rooms add column if not exists tasks_per_person smallint not null default 1;
alter table public.rooms add column if not exists links jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_tasks_per_person_range') then
    alter table public.rooms add constraint rooms_tasks_per_person_range check (tasks_per_person between 1 and 10);
  end if;
  -- up to 4 links (an earlier version allowed 2 under another name)
  alter table public.rooms drop constraint if exists rooms_links_shape;
  if not exists (select 1 from pg_constraint where conname = 'rooms_links_max_4') then
    alter table public.rooms add constraint rooms_links_max_4
      check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4);
  end if;
end $$;

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

-- After a spin, a member may ask to take over a task of the latest spin. The moderator or
-- whoever has the task approves or declines; the requester can withdraw. One row per person
-- and task per spin: a declined request stays declined for that spin, a withdrawn one can be
-- made again. A new spin marks every pending request 'superseded'.
create table if not exists public.takeover_requests (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references public.rooms (id) on delete cascade,
  spin_number smallint    not null check (spin_number in (1, 2)),
  task_id     text        not null check (char_length(task_id) between 1 and 64),
  user_id     uuid        not null,                                -- who asks
  status      text        not null default 'pending'
                          check (status in ('pending', 'approved', 'declined', 'withdrawn', 'superseded')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,                                                -- who approved or declined (null when superseded)
  constraint takeover_requests_one_per_task unique (room_id, spin_number, task_id, user_id),
  constraint takeover_requests_by_member foreign key (room_id, user_id)
    references public.participants (room_id, user_id) on delete cascade,
  constraint takeover_requests_resolved check ((status = 'pending') = (resolved_at is null))
);

-- Added with several testers per task: whose place the request is for (null = an unassigned task).
alter table public.takeover_requests add column if not exists from_user_id uuid;
-- Requests made before that were for the task's only tester.
update public.takeover_requests q
set from_user_id = (e ->> 'participant_id')::uuid
from public.spins s, jsonb_array_elements(s.assignments) e
where q.from_user_id is null and q.status in ('pending', 'declined', 'withdrawn')
  and s.room_id = q.room_id and s.spin_number = q.spin_number
  and (e ->> 'task_id') = q.task_id and nullif(e ->> 'participant_id', '') is not null;

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

-- Same rule as canReceiveTask() in domain.js and the device check in commit_spin: a Mac task
-- needs a Mac, a phone task needs one of the selected phones, both need both.
create or replace function public._wot_can_receive(p_task jsonb, p_mac boolean, p_android boolean, p_ios boolean)
returns boolean language sql immutable set search_path = '' as $$
  select (not public._wot_task_needs_mac(p_task) or coalesce(p_mac, false))
     and (cardinality(public._wot_task_phones(p_task)) = 0
          or (coalesce(p_android, false) and 'android' = any (public._wot_task_phones(p_task)))
          or (coalesce(p_ios, false) and 'ios' = any (public._wot_task_phones(p_task))))
$$;

-- -----------------------------------------------------------------------------
-- Settings and testers
-- -----------------------------------------------------------------------------

-- How many testers a task can have when people add themselves with "Assign me"
-- (maxTestersToJoin in config.js). The moderator's own changes are not limited.
create or replace function public.wot_max_testers_to_join()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;

-- The most a moderator can ask for per person (maxTasksPerPerson in config.js).
create or replace function public.wot_max_tasks_per_person()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

-- Tasks per person: a whole number from 1 to wot_max_tasks_per_person().
create or replace function public._wot_clean_tasks_per_person(p_value jsonb)
returns smallint language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return 1;
  end if;
  if jsonb_typeof(p_value) <> 'number'
     or (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric)
     or (p_value #>> '{}')::numeric not between 1 and public.wot_max_tasks_per_person() then
    perform public._wot_fail(
      format('Tasks per person must be a whole number from 1 to %s.', public.wot_max_tasks_per_person()),
      'invalid_settings', '22023');
  end if;
  return (p_value #>> '{}')::smallint;
end $$;

-- Session links: 0 to 4 of { label (0-40 characters), url (http or https, up to 500, no spaces) }.
-- Keep the 4 equal to maxLinks in config.js.
create or replace function public._wot_clean_links(p_links jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_link jsonb;
  v_label text;
  v_url text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 4 then
    perform public._wot_fail('A room has at most four session links.', 'invalid_links', '22023');
  end if;
  for v_link in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_link) <> 'object'
       or jsonb_typeof(v_link -> 'url') is distinct from 'string'
       or coalesce(jsonb_typeof(v_link -> 'label'), 'string') not in ('string', 'null') then
      perform public._wot_fail('A session link is malformed.', 'invalid_links', '22023');
    end if;
    v_label := regexp_replace(coalesce(v_link ->> 'label', ''), '^\s+|\s+$', '', 'g');
    v_url := btrim(v_link ->> 'url');
    if char_length(v_label) > 40 or v_label ~ '[\x01-\x1F\x7F]' then
      perform public._wot_fail('A link label can have at most 40 characters.', 'invalid_links', '22023');
    end if;
    if char_length(v_url) > 500 or v_url !~* '^https?://[^[:space:]/]+[^[:space:]]*$' then
      perform public._wot_fail('Session links must be http or https addresses.', 'invalid_links', '22023');
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('label', v_label, 'url', v_url));
  end loop;
  return v_out;
end $$;

-- An assignment entry's testers: [{ user_id, name, team, mac, android, ios, team_match, ... }].
-- Spins stored before a task could have several testers have participant_id / participant
-- instead; they are read the same way.
create or replace function public._wot_entry_owners(p_entry jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_entry -> 'owners') = 'array' then p_entry -> 'owners'
    when nullif(p_entry ->> 'participant_id', '') is null then '[]'::jsonb
    else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_entry -> 'participant_id',
      'name', p_entry -> 'participant' -> 'name', 'team', p_entry -> 'participant' -> 'team',
      'mac', p_entry -> 'participant' -> 'mac', 'android', p_entry -> 'participant' -> 'android',
      'ios', p_entry -> 'participant' -> 'ios', 'team_match', p_entry -> 'team_match',
      'took_over_from', p_entry -> 'took_over_from', 'took_over_by', p_entry -> 'took_over_by',
      'took_over_at', p_entry -> 'took_over_at')))
  end
$$;

create or replace function public._wot_owner_ids(p_entry jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select array(select o ->> 'user_id' from jsonb_array_elements(public._wot_entry_owners(p_entry)) o)
$$;

-- One tester as stored: name, team and devices from the participants table, never from the
-- client, plus the team match for this task and any extra fields (how they got it). Null if
-- the person is not in the room.
create or replace function public._wot_owner(p_room_id uuid, p_user_id uuid, p_task jsonb, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
           'user_id', p.user_id, 'name', p.name, 'team', p.team,
           'mac', p.mac, 'android', p.android, 'ios', p.ios,
           'team_match', case when (p_task ->> 'team') is null then null else p.team = (p_task ->> 'team') end)
         || coalesce(p_extra, '{}'::jsonb)
  from public.participants p
  where p.room_id = p_room_id and p.user_id = p_user_id
$$;

-- The entry with a new list of testers, in the current shape (the single-tester keys go).
-- With nobody left, the entry keeps the reason it had, or gets p_reason.
create or replace function public._wot_with_owners(p_entry jsonb, p_owners jsonb, p_reason text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select (p_entry - 'participant_id' - 'participant' - 'team_match'
                  - 'took_over_from' - 'took_over_by' - 'took_over_at')
         || jsonb_build_object(
              'owners', p_owners,
              'reason', case when jsonb_array_length(p_owners) = 0
                             then coalesce(p_entry ->> 'reason', p_reason, 'Unassigned.') end)
$$;

-- After the testers of a task changed, bring its requests (current spin) in line:
--   * someone who asked and is now a tester has what they wanted: approved;
--   * on a hand-over (p_from -> p_to), requests aimed at p_from now wait for p_to;
--   * requests aimed at someone who is no longer a tester are over (superseded), and so are
--     that person's refusals: whoever said no doesn't have the task any more, so the people
--     they turned down may ask again. A request for an unassigned task ends once it has testers.
create or replace function public._wot_reconcile_requests(
  p_room_id uuid, p_spin integer, p_task_id text, p_by uuid,
  p_from uuid default null, p_to uuid default null, p_handover boolean default false)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_owners text[];
begin
  select public._wot_owner_ids(e) into v_owners
  from public.spins s, jsonb_array_elements(s.assignments) e
  where s.room_id = p_room_id and s.spin_number = p_spin and (e ->> 'task_id') = p_task_id;
  v_owners := coalesce(v_owners, '{}');

  -- Whoever is a tester now has what they asked for, whatever became of the request
  -- (pending, declined, or declined and dismissed): settled, so it leaves every list.
  update public.takeover_requests
  set status = 'approved', resolved_at = now(), resolved_by = p_by
  where room_id = p_room_id and spin_number = p_spin and task_id = p_task_id
    and (status in ('pending', 'declined') or (status = 'withdrawn' and resolved_by is not null))
    and user_id::text = any (v_owners);

  if p_handover then
    update public.takeover_requests
    set from_user_id = p_to
    where room_id = p_room_id and spin_number = p_spin and task_id = p_task_id
      and status = 'pending' and from_user_id is not distinct from p_from;
  end if;

  update public.takeover_requests
  set status = 'superseded', resolved_at = coalesce(resolved_at, now())
  where room_id = p_room_id and spin_number = p_spin and task_id = p_task_id
    and (status in ('pending', 'declined') or (status = 'withdrawn' and resolved_by is not null))
    and case when from_user_id is null then cardinality(v_owners) > 0
             else not (from_user_id::text = any (v_owners)) end;
end $$;

-- The full room state a member sees. Called only from the RPCs below.
create or replace function public._wot_snapshot(p_room_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'exists', true,
    'member', true,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'host_user_id', r.host_user_id, 'status', r.status,
      'spins_used', r.spins_used, 'state_version', r.state_version, 'tasks', r.tasks,
      'tasks_per_person', r.tasks_per_person, 'links', r.links, 'created_at', r.created_at),
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
      from public.complaints c where c.room_id = r.id), '[]'::jsonb),
    -- takeover requests of the current spin only (a new spin starts with a clean slate)
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'task_id', q.task_id, 'user_id', q.user_id, 'from_user_id', q.from_user_id,
               'status', q.status,
               'created_at', q.created_at, 'resolved_at', q.resolved_at, 'resolved_by', q.resolved_by)
             order by q.created_at, q.id)
      from public.takeover_requests q where q.room_id = r.id and q.spin_number = r.spins_used), '[]'::jsonb)
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
-- Replaced by the version with p_settings (two overloads would make every call ambiguous).
drop function if exists public.create_room(jsonb, jsonb);
-- p_settings: { tasks_per_person: 1-10 (default 1), links: [{ label, url }] (0-4) }
create or replace function public.create_room(p_profile jsonb, p_tasks jsonb, p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_tasks jsonb;
  v_per_person smallint;
  v_links jsonb;
  v_room_id uuid;
  v_attempt integer := 0;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  v_profile := public._wot_clean_profile(p_profile);
  v_tasks := public._wot_clean_tasks(p_tasks);
  if p_settings is not null and jsonb_typeof(p_settings) not in ('object', 'null') then
    perform public._wot_fail('Room settings are malformed.', 'invalid_settings', '22023');
  end if;
  v_per_person := public._wot_clean_tasks_per_person(p_settings -> 'tasks_per_person');
  v_links := public._wot_clean_links(p_settings -> 'links');

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.rooms (code, host_user_id, tasks, tasks_per_person, links)
      values (public._wot_random_code(), v_uid, v_tasks, v_per_person, v_links)
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

-- p_assignments: one { task_id, task, owner_ids: [user id, ...] } per task. A page from before
-- several testers per task sends participant_id instead; it is read as a one-person list.
create or replace function public.commit_spin(p_room_id uuid, p_spin_number integer, p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_task_count integer;
  v_items jsonb;
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
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' or length(p_assignments::text) > 400000 then
    perform public._wot_fail('Assignments are missing or too large.', 'invalid_assignments', '22023');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'task_id') is distinct from 'string'
       or coalesce(jsonb_typeof(e -> 'owner_ids'), 'array') <> 'array'
       or coalesce(jsonb_typeof(e -> 'participant_id'), 'null') not in ('string', 'null')
       or jsonb_array_length(coalesce(e -> 'owner_ids', '[]'::jsonb)) > public.wot_room_capacity()
       or exists (select 1 from jsonb_array_elements(coalesce(e -> 'owner_ids', '[]'::jsonb)) o
                  where jsonb_typeof(o) <> 'string')
  ) then
    perform public._wot_fail('Assignments are malformed.', 'invalid_assignments', '22023');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', e -> 'task_id',
           'task', e -> 'task',
           'owner_ids', case
             when jsonb_typeof(e -> 'owner_ids') = 'array' then e -> 'owner_ids'
             when nullif(e ->> 'participant_id', '') is not null then jsonb_build_array(e -> 'participant_id')
             else '[]'::jsonb end)), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(p_assignments) e;

  -- Every task in the room exactly once. A mismatch usually means the moderator changed
  -- the tasks in another tab, so the client is told to re-fetch.
  v_task_count := jsonb_array_length(v_room.tasks);
  if jsonb_array_length(v_items) <> v_task_count
     or (select count(distinct e ->> 'task_id')
         from jsonb_array_elements(v_items) e
         where (e ->> 'task_id') in (select t ->> 'id' from jsonb_array_elements(v_room.tasks) t)
        ) <> v_task_count then
    perform public._wot_fail('The task list changed. The room has been refreshed, so spin again.', 'stale_spin');
  end if;
  -- ...and the client assigned the tasks as they are stored now (an edit can keep the id).
  if exists (
    select 1
    from jsonb_array_elements(v_items) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    where public._wot_task_phones(e -> 'task') is distinct from public._wot_task_phones(t)
       or public._wot_task_needs_mac(e -> 'task') is distinct from public._wot_task_needs_mac(t)
       or (e -> 'task' ->> 'team') is distinct from (t ->> 'team')
  ) then
    perform public._wot_fail('The task list changed. The room has been refreshed, so spin again.', 'stale_spin');
  end if;

  -- Nobody twice on one task
  if exists (
    select 1 from jsonb_array_elements(v_items) e
    where (select count(distinct o) from jsonb_array_elements_text(e -> 'owner_ids') o)
          <> jsonb_array_length(e -> 'owner_ids')
  ) then
    perform public._wot_fail('Each person can be on a task only once.', 'invalid_assignments', '22023');
  end if;

  -- Every tester is a member of this room
  if exists (
    select 1 from jsonb_array_elements(v_items) e, jsonb_array_elements_text(e -> 'owner_ids') o
    where not exists (select 1 from public.participants p
                      where p.room_id = p_room_id and p.user_id::text = o)
  ) then
    perform public._wot_fail('Tasks can only go to people in this room.', 'invalid_assignments', '22023');
  end if;

  -- Device rule, for every tester: a Mac task goes only to someone with a Mac; a phone task only
  -- to someone with one of the selected phones; a task with both needs both.
  if exists (
    select 1
    from jsonb_array_elements(v_items) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    cross join lateral jsonb_array_elements_text(e -> 'owner_ids') o
    join public.participants p on p.room_id = p_room_id and p.user_id::text = o
    where not public._wot_can_receive(t, p.mac, p.android, p.ios)
  ) then
    perform public._wot_fail('A task went to someone without the Mac or phone it needs.', 'invalid_assignments', '22023');
  end if;

  -- Desktop-only tasks can always be assigned (the moderator is online), so they may not be left empty
  if exists (
    select 1
    from jsonb_array_elements(v_items) e
    join jsonb_array_elements(v_room.tasks) t on (t ->> 'id') = (e ->> 'task_id')
    where jsonb_array_length(e -> 'owner_ids') = 0
      and cardinality(public._wot_task_phones(t)) = 0 and not public._wot_task_needs_mac(t)
  ) then
    perform public._wot_fail('Tasks that need no Mac or phone cannot be left unassigned.', 'invalid_assignments', '22023');
  end if;

  -- Store what the database knows, not the client's copies of names or tasks
  select jsonb_agg(jsonb_build_object(
           'task_id', t.task ->> 'id',
           'task', t.task,
           'owners', coalesce((
              select jsonb_agg(public._wot_owner(p_room_id, o.id::uuid, t.task) order by o.ord)
              from jsonb_array_elements_text(e -> 'owner_ids') with ordinality as o(id, ord)), '[]'::jsonb),
           'reason', case when jsonb_array_length(e -> 'owner_ids') = 0
                          then public._wot_unassigned_reason(public._wot_task_phones(t.task),
                                                             public._wot_task_needs_mac(t.task)) end
         ) order by t.ord)
  into v_stored
  from jsonb_array_elements(v_room.tasks) with ordinality as t(task, ord)
  join jsonb_array_elements(v_items) e on (e ->> 'task_id') = (t.task ->> 'id');

  insert into public.spins (room_id, spin_number, assignments)
  values (p_room_id, p_spin_number, v_stored);

  -- A new spin replaces every assignment, so requests about the old one are over.
  update public.takeover_requests
  set status = 'superseded', resolved_at = now()
  where room_id = p_room_id and status = 'pending';

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
-- Room settings and the moderator's changes after the spin
-- -----------------------------------------------------------------------------

-- Change { tasks_per_person, links (0-4) } (either may be left out). Moderator only. Tasks per
-- person decides the spin, so it changes only before the first one; the links any time.
create or replace function public.update_settings(p_room_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_per_person smallint;
  v_links jsonb;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  if v_room.host_user_id <> v_uid then
    perform public._wot_fail('Only the moderator can change the room settings.', 'not_host', '42501');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform public._wot_fail('Room settings are malformed.', 'invalid_settings', '22023');
  end if;
  v_per_person := v_room.tasks_per_person;
  v_links := v_room.links;
  if p_settings ? 'tasks_per_person' then
    v_per_person := public._wot_clean_tasks_per_person(p_settings -> 'tasks_per_person');
    if v_per_person <> v_room.tasks_per_person and (v_room.status <> 'lobby' or v_room.spins_used <> 0) then
      perform public._wot_fail('The wheel has already spun, so tasks per person can no longer change.', 'settings_locked');
    end if;
  end if;
  if p_settings ? 'links' then
    v_links := public._wot_clean_links(p_settings -> 'links');
  end if;
  if v_per_person = v_room.tasks_per_person and v_links = v_room.links then
    return public._wot_snapshot(p_room_id);  -- nothing changed
  end if;
  update public.rooms
  set tasks_per_person = v_per_person, links = v_links, state_version = state_version + 1
  where id = p_room_id;
  return public._wot_snapshot(p_room_id);
end $$;

-- Add a task (p_is_new) or change one, together with who tests it, after the wheel has spun.
-- Moderator only. p_owner_ids: the testers in order ([] = nobody). p_spin_number is the spin
-- the moderator was looking at; a spin that landed since then makes the call stale. The task
-- changes in the room's list (so a second spin uses it) and in the current spin.
create or replace function public.save_task(p_room_id uuid, p_spin_number integer, p_task jsonb, p_owner_ids jsonb, p_is_new boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_spin public.spins%rowtype;
  v_task jsonb;
  v_id text;
  v_task_index integer;
  v_index integer;
  v_entry jsonb;
  v_old_owners jsonb;
  v_new_owners jsonb := '[]'::jsonb;
  v_prev jsonb;
  v_owner text;
  v_p public.participants%rowtype;
  v_bad text[] := '{}';
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
  if v_room.status = 'lobby' then
    perform public._wot_fail('Until the wheel spins, change the tasks in the task list.', 'not_spun');
  end if;
  if p_spin_number is distinct from v_room.spins_used::integer then
    perform public._wot_fail('The wheel has spun again. The room has been refreshed.', 'stale_spin');
  end if;
  if p_is_new is null then
    perform public._wot_fail('Say whether the task is new.', 'invalid_tasks', '22023');
  end if;

  -- The task on its own (older rooms may keep tasks in an older shape; those stay as they are)
  v_task := public._wot_clean_tasks(jsonb_build_array(p_task)) -> 0;
  v_id := v_task ->> 'id';
  select x.ord - 1 into v_task_index
  from jsonb_array_elements(v_room.tasks) with ordinality as x(t, ord) where (x.t ->> 'id') = v_id;
  if p_is_new and v_task_index is not null then
    perform public._wot_fail('A task with this id already exists. Try again.', 'task_exists');
  end if;
  if not p_is_new and v_task_index is null then
    perform public._wot_fail('That task no longer exists. The room has been refreshed.', 'task_not_found');
  end if;
  if p_is_new and jsonb_array_length(v_room.tasks) >= 50 then
    perform public._wot_fail('A room can have at most 50 tasks.', 'too_many_tasks');
  end if;

  -- The testers
  if p_owner_ids is null or jsonb_typeof(p_owner_ids) <> 'array'
     or jsonb_array_length(p_owner_ids) > public.wot_room_capacity()
     or exists (select 1 from jsonb_array_elements(p_owner_ids) o where jsonb_typeof(o) <> 'string')
     or (select count(distinct o) from jsonb_array_elements_text(p_owner_ids) o) <> jsonb_array_length(p_owner_ids) then
    perform public._wot_fail('The list of testers is malformed.', 'invalid_owners', '22023');
  end if;

  select * into v_spin from public.spins where room_id = p_room_id and spin_number = v_room.spins_used for update;
  select x.ord - 1, x.e into v_index, v_entry
  from jsonb_array_elements(v_spin.assignments) with ordinality as x(e, ord) where (x.e ->> 'task_id') = v_id;
  v_old_owners := case when v_entry is null then '[]'::jsonb else public._wot_entry_owners(v_entry) end;

  for v_owner in select value from jsonb_array_elements_text(p_owner_ids) loop
    select * into v_p from public.participants where room_id = p_room_id and user_id::text = v_owner;
    if not found then
      perform public._wot_fail('Tasks can only go to people in this room.', 'invalid_owners', '22023');
    end if;
    if not public._wot_can_receive(v_task, v_p.mac, v_p.android, v_p.ios) then
      v_bad := v_bad || v_p.name;
      continue;
    end if;
    -- Someone who stays keeps how they got the task; someone new is marked as given by the moderator
    select o into v_prev from jsonb_array_elements(v_old_owners) o where (o ->> 'user_id') = v_owner;
    v_new_owners := v_new_owners || jsonb_build_array(public._wot_owner(p_room_id, v_p.user_id, v_task,
      case when v_prev is null then jsonb_build_object('assigned_by', v_uid, 'assigned_at', now())
           else v_prev - 'user_id' - 'name' - 'team' - 'mac' - 'android' - 'ios' - 'team_match' end));
  end loop;
  if cardinality(v_bad) > 0 then
    perform public._wot_fail(
      format('%s %s not have the Mac or phone this task needs.', array_to_string(v_bad, ', '),
             case when cardinality(v_bad) = 1 then 'does' else 'do' end),
      'device_mismatch');
  end if;

  v_entry := public._wot_with_owners(
    coalesce(v_entry, jsonb_build_object('task_id', v_id)) || jsonb_build_object('task', v_task),
    v_new_owners, 'Unassigned by the moderator.');
  if jsonb_array_length(v_new_owners) = 0 and jsonb_array_length(v_old_owners) > 0 then
    v_entry := v_entry || jsonb_build_object('reason', 'Unassigned by the moderator.');
  end if;

  update public.spins
  set assignments = case when v_index is null then assignments || jsonb_build_array(v_entry)
                         else jsonb_set(assignments, array[v_index::text], v_entry) end
  where id = v_spin.id;
  update public.rooms
  set tasks = case when v_task_index is null then tasks || jsonb_build_array(v_task)
                   else jsonb_set(tasks, array[v_task_index::text], v_task) end,
      state_version = state_version + 1
  where id = p_room_id;

  perform public._wot_reconcile_requests(p_room_id, v_room.spins_used, v_id, v_uid);
  return public._wot_snapshot(p_room_id);
end $$;

-- Delete a task after the wheel has spun: it leaves the room's list and the current spin
-- (an earlier spin keeps it, as history). Requests about it are over. Moderator only.
create or replace function public.delete_task(p_room_id uuid, p_spin_number integer, p_task_id text)
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
  if v_room.host_user_id <> v_uid then
    perform public._wot_fail('Only the moderator can change the tasks.', 'not_host', '42501');
  end if;
  if v_room.status = 'lobby' then
    perform public._wot_fail('Until the wheel spins, change the tasks in the task list.', 'not_spun');
  end if;
  if p_spin_number is distinct from v_room.spins_used::integer then
    perform public._wot_fail('The wheel has spun again. The room has been refreshed.', 'stale_spin');
  end if;
  if not exists (select 1 from jsonb_array_elements(v_room.tasks) t where (t ->> 'id') = p_task_id) then
    perform public._wot_fail('That task no longer exists. The room has been refreshed.', 'task_not_found');
  end if;
  if jsonb_array_length(v_room.tasks) <= 1 then
    perform public._wot_fail('A room needs at least one task.', 'last_task');
  end if;

  update public.spins
  set assignments = coalesce((select jsonb_agg(e order by ord)
                              from jsonb_array_elements(assignments) with ordinality as x(e, ord)
                              where (e ->> 'task_id') <> p_task_id), '[]'::jsonb)
  where room_id = p_room_id and spin_number = v_room.spins_used;
  update public.rooms
  set tasks = (select jsonb_agg(t order by ord)
               from jsonb_array_elements(tasks) with ordinality as x(t, ord)
               where (t ->> 'id') <> p_task_id),
      state_version = state_version + 1
  where id = p_room_id;
  update public.takeover_requests
  set status = 'superseded', resolved_at = coalesce(resolved_at, now())
  where room_id = p_room_id and spin_number = v_room.spins_used and task_id = p_task_id
    and status in ('pending', 'declined', 'withdrawn');
  return public._wot_snapshot(p_room_id);
end $$;

-- -----------------------------------------------------------------------------
-- Takeover requests. All three lock the room row first, like commit_spin, so a
-- request, an answer and a spin never interleave.
-- -----------------------------------------------------------------------------

-- Replaced by the version with p_from_user_id (two overloads would make every call ambiguous).
drop function if exists public.request_takeover(uuid, text);
-- Ask to take over a task of the latest spin: the place of tester p_from_user_id, or the
-- task itself while it is unassigned (null). Null on a task with exactly one tester means
-- that tester. Idempotent while the same request is pending; asking for another place on the
-- same task moves the pending request there.
create or replace function public.request_takeover(p_room_id uuid, p_task_id text, p_from_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_me public.participants%rowtype;
  v_entry jsonb;
  v_owners text[];
  v_from uuid := p_from_user_id;
  v_existing public.takeover_requests%rowtype;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  select * into v_me from public.participants where room_id = p_room_id and user_id = v_uid;
  if not found then
    perform public._wot_fail('Only people in this room can ask to take over a task.', 'not_member', '42501');
  end if;
  if v_room.status = 'lobby' then
    perform public._wot_fail('You can ask to take over a task once the wheel has spun.', 'takeovers_closed');
  end if;
  if p_task_id is null or char_length(p_task_id) not between 1 and 64 then
    perform public._wot_fail('That task is not in this spin.', 'task_not_found', '22023');
  end if;

  -- The task as it stands in the latest spin
  select e into v_entry
  from public.spins s, jsonb_array_elements(s.assignments) e
  where s.room_id = p_room_id and s.spin_number = v_room.spins_used and (e ->> 'task_id') = p_task_id;
  if v_entry is null then
    perform public._wot_fail('That task is not in this spin.', 'task_not_found');
  end if;
  v_owners := public._wot_owner_ids(v_entry);
  if v_uid::text = any (v_owners) then
    perform public._wot_fail('This task is already yours.', 'already_assigned');
  end if;
  if v_from is null and cardinality(v_owners) = 1 then
    v_from := v_owners[1]::uuid;
  elsif v_from is null and cardinality(v_owners) > 1 then
    perform public._wot_fail('Several people test this task. Choose whose place you want to take.', 'choose_tester', '22023');
  elsif v_from is not null and not (v_from::text = any (v_owners)) then
    perform public._wot_fail('That person no longer has this task. The room has been refreshed.', 'tester_gone');
  end if;
  if not public._wot_can_receive(v_entry -> 'task', v_me.mac, v_me.android, v_me.ios) then
    perform public._wot_fail('You do not have the Mac or phone this task needs.', 'device_mismatch');
  end if;

  select * into v_existing from public.takeover_requests
  where room_id = p_room_id and spin_number = v_room.spins_used and task_id = p_task_id and user_id = v_uid;
  if found then
    if v_existing.status = 'pending' and v_existing.from_user_id is not distinct from v_from then
      return public._wot_snapshot(p_room_id);  -- already asked: nothing changes
    end if;
    -- A refusal (declined, or declined and then dismissed) holds for the rest of the spin, for
    -- every place on the task: the request isn't moved elsewhere, so nobody is asked twice. It
    -- is lifted when the tester who declined no longer has the task (see _wot_reconcile_requests).
    if v_existing.status = 'declined' or (v_existing.status = 'withdrawn' and v_existing.resolved_by is not null) then
      perform public._wot_fail('Your request for this task was declined.', 'request_declined');
    end if;
  end if;
  if (v_existing.id is null or v_existing.status <> 'pending')
     and (select count(*) from public.takeover_requests
          where room_id = p_room_id and spin_number = v_room.spins_used and user_id = v_uid and status = 'pending')
         >= public.wot_max_pending_requests() then
    perform public._wot_fail(
      format('You can have at most %s requests waiting. Withdraw one to ask for another.', public.wot_max_pending_requests()),
      'too_many_requests');
  end if;
  if v_existing.id is not null then
    update public.takeover_requests
    set status = 'pending', from_user_id = v_from, created_at = now(), resolved_at = null, resolved_by = null
    where id = v_existing.id;
  else
    insert into public.takeover_requests (room_id, spin_number, task_id, user_id, from_user_id)
    values (p_room_id, v_room.spins_used, p_task_id, v_uid, v_from);
  end if;

  update public.rooms set state_version = state_version + 1 where id = p_room_id;
  return public._wot_snapshot(p_room_id);
end $$;

-- Approve (p_approve = true) or decline a pending request. The moderator may answer any
-- request; a tester may answer requests for their own place. Approval puts the requester in
-- that place (or on the unassigned task), keeping who had it in took_over_from. A declined
-- request can still be approved later (a change of mind); an approved one is settled.
create or replace function public.resolve_takeover(p_request_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_room public.rooms%rowtype;
  v_req public.takeover_requests%rowtype;
  v_spin public.spins%rowtype;
  v_index integer;
  v_entry jsonb;
  v_owners jsonb;
  v_owner_ids text[];
  v_from jsonb;
  v_new jsonb;
  v_who public.participants%rowtype;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  if p_approve is null then
    perform public._wot_fail('Say whether the request is approved or declined.', 'invalid_decision', '22023');
  end if;
  select room_id into v_room_id from public.takeover_requests where id = p_request_id;
  if not found then
    perform public._wot_fail('That request no longer exists. The room has been refreshed.', 'request_not_pending');
  end if;
  select * into v_room from public.rooms where id = v_room_id for update;
  select * into v_req from public.takeover_requests where id = p_request_id;  -- re-read under the lock
  if found and v_req.spin_number = v_room.spins_used and v_req.status in ('approved', 'declined')
     and (v_req.status = 'approved') = p_approve then
    return public._wot_snapshot(v_room.id);  -- someone else just made the same decision: nothing to do
  end if;
  if not found or v_req.spin_number <> v_room.spins_used
     or not (v_req.status = 'pending' or (v_req.status = 'declined' and p_approve)) then
    perform public._wot_fail('That request is no longer pending. The room has been refreshed.', 'request_not_pending');
  end if;
  if not exists (select 1 from public.participants where room_id = v_room.id and user_id = v_uid) then
    perform public._wot_fail('Only people in this room can answer requests.', 'not_member', '42501');
  end if;

  select * into v_spin from public.spins where room_id = v_room.id and spin_number = v_room.spins_used for update;
  select x.ord - 1, x.e into v_index, v_entry
  from jsonb_array_elements(v_spin.assignments) with ordinality as x(e, ord)
  where (x.e ->> 'task_id') = v_req.task_id;
  if v_entry is null then
    perform public._wot_fail('That task is not in this spin.', 'task_not_found');
  end if;
  v_owners := public._wot_entry_owners(v_entry);
  v_owner_ids := public._wot_owner_ids(v_entry);
  -- The place asked for must still be as it was (changes to the testers settle requests,
  -- so this only trips on a stale call)
  if (v_req.from_user_id is null and cardinality(v_owner_ids) > 0)
     or (v_req.from_user_id is not null and not (v_req.from_user_id::text = any (v_owner_ids))) then
    perform public._wot_fail('That request is no longer pending. The room has been refreshed.', 'request_not_pending');
  end if;
  if v_uid <> v_room.host_user_id and (v_req.from_user_id is null or v_req.from_user_id <> v_uid) then
    perform public._wot_fail('Only the moderator or the person whose place is asked for can answer this request.', 'not_allowed', '42501');
  end if;

  if p_approve then
    select * into v_who from public.participants where room_id = v_room.id and user_id = v_req.user_id;
    if not found then
      perform public._wot_fail('The person who asked is no longer in this room.', 'requester_gone');
    end if;
    if v_who.user_id::text = any (v_owner_ids) then
      perform public._wot_fail('They already have this task.', 'already_assigned');
    end if;
    if not public._wot_can_receive(v_entry -> 'task', v_who.mac, v_who.android, v_who.ios) then
      perform public._wot_fail('They no longer have the Mac or phone this task needs.', 'device_mismatch');
    end if;
    select o into v_from from jsonb_array_elements(v_owners) o where (o ->> 'user_id') = v_req.from_user_id::text;
    v_new := public._wot_owner(v_room.id, v_who.user_id, v_entry -> 'task', jsonb_build_object(
      'took_over_from', case when v_from is null then null
                             else jsonb_build_object('user_id', v_from -> 'user_id', 'name', v_from -> 'name') end,
      'took_over_by', v_uid,   -- who approved: the tester whose place it was, or the moderator
      'took_over_at', now()));
    -- Same place in the list as the tester it replaces; on an unassigned task, the first tester
    v_owners := case when v_from is null then jsonb_build_array(v_new) else coalesce((
      select jsonb_agg(case when (o ->> 'user_id') = v_req.from_user_id::text then v_new else o end order by ord)
      from jsonb_array_elements(v_owners) with ordinality as x(o, ord)), '[]'::jsonb) end;
    update public.spins
    set assignments = jsonb_set(assignments, array[v_index::text], public._wot_with_owners(v_entry, v_owners))
    where id = v_spin.id;
  end if;

  update public.takeover_requests
  set status = case when p_approve then 'approved' else 'declined' end, resolved_at = now(), resolved_by = v_uid
  where id = p_request_id;
  if p_approve then
    perform public._wot_reconcile_requests(v_room.id, v_room.spins_used, v_req.task_id, v_uid,
                                           v_req.from_user_id, v_req.user_id, true);
  end if;
  update public.rooms set state_version = state_version + 1 where id = v_room.id;
  return public._wot_snapshot(v_room.id);
end $$;

-- Take back your own pending request, or dismiss a declined one so it no longer waits for a
-- change of mind (it stays declined for you). Anything else is left as it is.
create or replace function public.withdraw_takeover(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_req public.takeover_requests%rowtype;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select room_id into v_room_id from public.takeover_requests where id = p_request_id;
  if not found then
    perform public._wot_fail('That request no longer exists. The room has been refreshed.', 'request_not_pending');
  end if;
  perform 1 from public.rooms where id = v_room_id for update;
  select * into v_req from public.takeover_requests where id = p_request_id;
  if not found or v_req.user_id <> v_uid then
    perform public._wot_fail('You can only withdraw your own request.', 'not_allowed', '42501');
  end if;
  if v_req.status in ('pending', 'declined') then
    update public.takeover_requests set status = 'withdrawn', resolved_at = now() where id = p_request_id;
    update public.rooms set state_version = state_version + 1 where id = v_room_id;
  end if;
  return public._wot_snapshot(v_room_id);
end $$;


-- -----------------------------------------------------------------------------
-- Assign me / Leave: a member adds themselves to a task of the current spin as an
-- extra tester (nothing is taken from anyone, so no approval), while it has fewer
-- than wot_max_testers_to_join() testers; and leaves a task they joined themselves.
-- -----------------------------------------------------------------------------
create or replace function public.join_task(p_room_id uuid, p_spin_number integer, p_task_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_me public.participants%rowtype;
  v_spin public.spins%rowtype;
  v_index integer;
  v_entry jsonb;
  v_owners jsonb;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  select * into v_me from public.participants where room_id = p_room_id and user_id = v_uid;
  if not found then
    perform public._wot_fail('Only people in this room can test its tasks.', 'not_member', '42501');
  end if;
  if v_room.status = 'lobby' then
    perform public._wot_fail('You can assign yourself once the wheel has spun.', 'takeovers_closed');
  end if;
  if p_spin_number is distinct from v_room.spins_used::integer then
    perform public._wot_fail('The wheel has spun again. The room has been refreshed.', 'stale_spin');
  end if;
  select * into v_spin from public.spins where room_id = p_room_id and spin_number = v_room.spins_used for update;
  select x.ord - 1, x.e into v_index, v_entry
  from jsonb_array_elements(v_spin.assignments) with ordinality as x(e, ord) where (x.e ->> 'task_id') = p_task_id;
  if v_entry is null then
    perform public._wot_fail('That task is not in this spin.', 'task_not_found');
  end if;
  v_owners := public._wot_entry_owners(v_entry);
  if v_uid::text = any (public._wot_owner_ids(v_entry)) then
    perform public._wot_fail('This task is already yours.', 'already_assigned');
  end if;
  if not public._wot_can_receive(v_entry -> 'task', v_me.mac, v_me.android, v_me.ios) then
    perform public._wot_fail('You do not have the Mac or phone this task needs.', 'device_mismatch');
  end if;
  if jsonb_array_length(v_owners) >= public.wot_max_testers_to_join() then
    perform public._wot_fail(
      format('This task already has %s testers. Ask to take over a place instead.', public.wot_max_testers_to_join()),
      'task_full');
  end if;

  v_owners := v_owners || jsonb_build_array(public._wot_owner(p_room_id, v_uid, v_entry -> 'task', jsonb_build_object('joined_at', now())));
  update public.spins
  set assignments = jsonb_set(assignments, array[v_index::text], public._wot_with_owners(v_entry, v_owners))
  where id = v_spin.id;
  perform public._wot_reconcile_requests(p_room_id, v_room.spins_used, p_task_id, v_uid);
  update public.rooms set state_version = state_version + 1 where id = p_room_id;
  return public._wot_snapshot(p_room_id);
end $$;

-- Leave a task you joined yourself. A task you got from the spin, a takeover or the
-- moderator stays yours; ask the moderator to change it.
create or replace function public.leave_task(p_room_id uuid, p_spin_number integer, p_task_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_spin public.spins%rowtype;
  v_index integer;
  v_entry jsonb;
  v_owners jsonb;
  v_mine jsonb;
begin
  if v_uid is null then
    perform public._wot_fail('You are not signed in.', 'not_signed_in', '42501');
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform public._wot_fail('This room does not exist.', 'room_not_found');
  end if;
  if v_room.status = 'lobby' then
    perform public._wot_fail('There is nothing to leave before the wheel spins.', 'takeovers_closed');
  end if;
  if p_spin_number is distinct from v_room.spins_used::integer then
    perform public._wot_fail('The wheel has spun again. The room has been refreshed.', 'stale_spin');
  end if;
  select * into v_spin from public.spins where room_id = p_room_id and spin_number = v_room.spins_used for update;
  select x.ord - 1, x.e into v_index, v_entry
  from jsonb_array_elements(v_spin.assignments) with ordinality as x(e, ord) where (x.e ->> 'task_id') = p_task_id;
  if v_entry is null then
    perform public._wot_fail('That task is not in this spin.', 'task_not_found');
  end if;
  v_owners := public._wot_entry_owners(v_entry);
  select o into v_mine from jsonb_array_elements(v_owners) o where (o ->> 'user_id') = v_uid::text;
  if v_mine is null then
    perform public._wot_fail('You are not on this task.', 'not_assigned');
  end if;
  if (v_mine ->> 'joined_at') is null then
    perform public._wot_fail('Only a task you assigned yourself to can be left. Ask the moderator to change it.', 'not_allowed', '42501');
  end if;

  v_owners := coalesce((select jsonb_agg(o order by ord) from jsonb_array_elements(v_owners) with ordinality as x(o, ord)
                        where (o ->> 'user_id') <> v_uid::text), '[]'::jsonb);
  update public.spins
  set assignments = jsonb_set(assignments, array[v_index::text], public._wot_with_owners(v_entry, v_owners, 'Nobody tests this task now.'))
  where id = v_spin.id;
  perform public._wot_reconcile_requests(p_room_id, v_room.spins_used, p_task_id, v_uid);
  update public.rooms set state_version = state_version + 1 where id = p_room_id;
  return public._wot_snapshot(p_room_id);
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security: members may read their room; nobody writes directly.
-- -----------------------------------------------------------------------------
alter table public.rooms        enable row level security;
alter table public.participants enable row level security;
alter table public.spins        enable row level security;
alter table public.complaints   enable row level security;
alter table public.takeover_requests enable row level security;

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

drop policy if exists "members read takeover requests" on public.takeover_requests;
create policy "members read takeover requests" on public.takeover_requests
  for select to authenticated using (public.is_room_member(room_id));

-- -----------------------------------------------------------------------------
-- Grants. Supabase grants ALL on new public tables/functions to anon and
-- authenticated by default, so revoke explicitly, then grant the minimum.
-- -----------------------------------------------------------------------------
revoke all on table public.rooms, public.participants, public.spins, public.complaints, public.takeover_requests
  from public, anon, authenticated;
grant select on table public.rooms, public.participants, public.spins, public.complaints, public.takeover_requests
  to authenticated;

revoke all on function public.wot_room_capacity()               from public, anon, authenticated;
revoke all on function public.wot_complaint_threshold()         from public, anon, authenticated;
revoke all on function public.wot_max_pending_requests()        from public, anon, authenticated;
revoke all on function public.wot_max_tasks_per_person()        from public, anon, authenticated;
revoke all on function public.wot_max_testers_to_join()         from public, anon, authenticated;
revoke all on function public._wot_clean_tasks_per_person(jsonb) from public, anon, authenticated;
revoke all on function public._wot_clean_links(jsonb)           from public, anon, authenticated;
revoke all on function public._wot_entry_owners(jsonb)          from public, anon, authenticated;
revoke all on function public._wot_owner_ids(jsonb)             from public, anon, authenticated;
revoke all on function public._wot_owner(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._wot_with_owners(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._wot_reconcile_requests(uuid, integer, text, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public._wot_fail(text, text, text)       from public, anon, authenticated;
revoke all on function public._wot_normalize_code(text)         from public, anon, authenticated;
revoke all on function public._wot_random_code()                from public, anon, authenticated;
revoke all on function public._wot_clean_profile(jsonb)         from public, anon, authenticated;
revoke all on function public._wot_clean_tasks(jsonb)           from public, anon, authenticated;
revoke all on function public._wot_is_string_list(jsonb, integer, integer, text[]) from public, anon, authenticated;
revoke all on function public._wot_task_phones(jsonb)           from public, anon, authenticated;
revoke all on function public._wot_task_needs_mac(jsonb)        from public, anon, authenticated;
revoke all on function public._wot_unassigned_reason(text[], boolean) from public, anon, authenticated;
revoke all on function public._wot_can_receive(jsonb, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public._wot_snapshot(uuid)               from public, anon, authenticated;

revoke all on function public.is_room_member(uuid)              from public, anon, authenticated;
grant execute on function public.is_room_member(uuid)           to authenticated;  -- needed by RLS

revoke all on function public.create_room(jsonb, jsonb, jsonb)                 from public, anon, authenticated;
revoke all on function public.join_room(text, jsonb)                    from public, anon, authenticated;
revoke all on function public.get_room(text)                            from public, anon, authenticated;
revoke all on function public.commit_spin(uuid, integer, jsonb)         from public, anon, authenticated;
revoke all on function public.complain(uuid)                            from public, anon, authenticated;
revoke all on function public.update_tasks(uuid, jsonb)                 from public, anon, authenticated;
revoke all on function public.request_takeover(uuid, text, uuid)              from public, anon, authenticated;
revoke all on function public.resolve_takeover(uuid, boolean)           from public, anon, authenticated;
revoke all on function public.withdraw_takeover(uuid)                   from public, anon, authenticated;
revoke all on function public.update_settings(uuid, jsonb)              from public, anon, authenticated;
revoke all on function public.save_task(uuid, integer, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.delete_task(uuid, integer, text)          from public, anon, authenticated;
revoke all on function public.join_task(uuid, integer, text)            from public, anon, authenticated;
revoke all on function public.leave_task(uuid, integer, text)           from public, anon, authenticated;
grant execute on function public.create_room(jsonb, jsonb, jsonb)              to authenticated;
grant execute on function public.join_room(text, jsonb)                 to authenticated;
grant execute on function public.get_room(text)                         to authenticated;
grant execute on function public.commit_spin(uuid, integer, jsonb)      to authenticated;
grant execute on function public.complain(uuid)                         to authenticated;
grant execute on function public.update_tasks(uuid, jsonb)              to authenticated;
grant execute on function public.request_takeover(uuid, text, uuid)           to authenticated;
grant execute on function public.resolve_takeover(uuid, boolean)        to authenticated;
grant execute on function public.withdraw_takeover(uuid)                to authenticated;
grant execute on function public.update_settings(uuid, jsonb)           to authenticated;
grant execute on function public.save_task(uuid, integer, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.delete_task(uuid, integer, text)       to authenticated;
grant execute on function public.join_task(uuid, integer, text)         to authenticated;
grant execute on function public.leave_task(uuid, integer, text)        to authenticated;

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
