-- Production schema snapshot for Quái Vật Đường Phố v1.
-- This migration is intentionally idempotent so an existing production
-- project can keep its data while a fresh project receives every object that
-- was created during the MVP iterations.

create schema if not exists private;

create table if not exists public.player_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Nguoi choi'
    check (char_length(display_name) between 2 and 16),
  coins integer not null default 150 check (coins >= 0),
  skin text not null default 'cat',
  trail text not null default 'none',
  owned_skins jsonb not null default jsonb_build_array('cat'),
  owned_trails jsonb not null default jsonb_build_array('none'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rank_points integer not null default 0 check (rank_points >= 0),
  kills integer not null default 0 check (kills >= 0),
  deaths integer not null default 0 check (deaths >= 0)
);

alter table public.player_profiles enable row level security;
revoke all on table public.player_profiles from anon, authenticated;
grant select on table public.player_profiles to authenticated;

drop policy if exists "Players can read their own profile"
  on public.player_profiles;
create policy "Players can read their own profile"
on public.player_profiles
for select
to authenticated
using ((select auth.uid()) = id);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_profiles_updated_at
  on public.player_profiles;
create trigger player_profiles_updated_at
before update on public.player_profiles
for each row execute function public.set_profile_updated_at();

create or replace function public.create_player_profile()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.player_profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        'Nguoi choi'
      ),
      16
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_player_profile()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_player_profile();

create or replace function private.ensure_player_profile_internal(
  p_display_name text default null
)
returns public.player_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_name text;
  v_profile public.player_profiles;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  v_name := left(trim(coalesce(p_display_name, '')), 16);
  if char_length(v_name) < 2 then
    select left(
      coalesce(
        nullif(trim(raw_user_meta_data ->> 'display_name'), ''),
        'Nguoi choi'
      ),
      16
    )
    into v_name
    from auth.users
    where id = v_user_id;
  end if;

  insert into public.player_profiles (id, display_name)
  values (v_user_id, coalesce(v_name, 'Nguoi choi'))
  on conflict (id) do nothing;

  select *
  into v_profile
  from public.player_profiles
  where id = v_user_id;

  return v_profile;
end;
$$;

create or replace function public.ensure_player_profile(
  p_display_name text default null
)
returns public.player_profiles
language sql
set search_path = ''
as $$
  select private.ensure_player_profile_internal(p_display_name);
$$;

create or replace function private.purchase_or_equip_cosmetic_internal(
  p_kind text,
  p_item_id text
)
returns public.player_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_price integer;
  v_owned boolean;
  v_profile public.player_profiles;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  if p_kind = 'skin' then
    v_price := case p_item_id
      when 'cat' then 0
      when 'fox' then 120
      when 'robot' then 180
      when 'unicorn' then 250
      when 'panda' then 320
      when 'frog' then 400
      else null
    end;
  elsif p_kind = 'trail' then
    v_price := case p_item_id
      when 'none' then 0
      when 'rainbow' then 120
      when 'clover' then 100
      when 'chili' then 100
      when 'water' then 90
      when 'stars' then 180
      else null
    end;
  else
    raise exception using
      errcode = '22023',
      message = 'invalid_cosmetic_kind';
  end if;

  if v_price is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_cosmetic_item';
  end if;

  perform private.ensure_player_profile_internal(null);

  select *
  into v_profile
  from public.player_profiles
  where id = v_user_id
  for update;

  v_owned := case p_kind
    when 'skin' then v_profile.owned_skins ? p_item_id
    else v_profile.owned_trails ? p_item_id
  end;

  if not v_owned and v_profile.coins < v_price then
    raise exception using
      errcode = 'P0001',
      message = 'not_enough_coins';
  end if;

  update public.player_profiles
  set
    coins = coins - case when v_owned then 0 else v_price end,
    skin = case when p_kind = 'skin' then p_item_id else skin end,
    trail = case when p_kind = 'trail' then p_item_id else trail end,
    owned_skins = case
      when p_kind = 'skin' and not v_owned
        then owned_skins || jsonb_build_array(p_item_id)
      else owned_skins
    end,
    owned_trails = case
      when p_kind = 'trail' and not v_owned
        then owned_trails || jsonb_build_array(p_item_id)
      else owned_trails
    end
  where id = v_user_id
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.purchase_or_equip_cosmetic(
  p_kind text,
  p_item_id text
)
returns public.player_profiles
language sql
set search_path = ''
as $$
  select private.purchase_or_equip_cosmetic_internal(p_kind, p_item_id);
$$;

create table if not exists private.verified_eliminations (
  id uuid primary key default gen_random_uuid(),
  victim_id uuid not null references auth.users(id) on delete cascade,
  killer_id uuid not null references auth.users(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  room_number integer not null check (room_number > 0),
  score_points smallint not null default 15
    check (score_points between 0 and 100),
  coin_reward smallint not null default 10
    check (coin_reward between 0 and 50),
  created_at timestamptz not null default now()
);

alter table private.verified_eliminations enable row level security;
revoke all on table private.verified_eliminations
  from public, anon, authenticated;

create index if not exists verified_eliminations_killer_created_idx
  on private.verified_eliminations (killer_id, created_at desc);
create index if not exists verified_eliminations_victim_created_idx
  on private.verified_eliminations (victim_id, created_at desc);

create or replace function private.report_verified_elimination_internal(
  p_killer_id uuid
)
returns table (
  event_id uuid,
  score_points integer,
  coin_reward integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_victim_id uuid := (select auth.uid());
  v_country text;
  v_room integer;
  v_event_id uuid;
  v_score integer := 15;
  v_reward integer := 10;
  v_daily_coins integer;
begin
  if v_victim_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  if p_killer_id is null or p_killer_id = v_victim_id then
    raise exception using
      errcode = '22023',
      message = 'invalid_killer';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_victim_id::text, 0)
  );

  select country_code, room_number
  into v_country, v_room
  from public.public_matchmaking
  where user_id = v_victim_id;

  if v_country is null then
    raise exception using
      errcode = 'P0001',
      message = 'victim_not_in_active_match';
  end if;

  if not exists (
    select 1
    from public.public_matchmaking
    where user_id = p_killer_id
      and country_code = v_country
      and room_number = v_room
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'killer_not_in_same_match';
  end if;

  if exists (
    select 1
    from private.verified_eliminations
    where victim_id = v_victim_id
      and created_at > now() - interval '4 seconds'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'elimination_cooldown';
  end if;

  select coalesce(sum(e.coin_reward), 0)::integer
  into v_daily_coins
  from private.verified_eliminations e
  where e.killer_id = p_killer_id
    and e.created_at >= date_trunc('day', now());

  v_reward := greatest(0, least(v_reward, 500 - v_daily_coins));

  insert into private.verified_eliminations (
    victim_id,
    killer_id,
    country_code,
    room_number,
    score_points,
    coin_reward
  )
  values (
    v_victim_id,
    p_killer_id,
    v_country,
    v_room,
    v_score,
    v_reward
  )
  returning id into v_event_id;

  update public.player_profiles
  set
    coins = coins + v_reward,
    rank_points = rank_points + v_score,
    kills = kills + 1
  where id = p_killer_id;

  update public.player_profiles
  set deaths = deaths + 1
  where id = v_victim_id;

  return query
  select v_event_id, v_score, v_reward;
end;
$$;

create or replace function public.report_verified_elimination(
  p_killer_id uuid
)
returns table (
  event_id uuid,
  score_points integer,
  coin_reward integer
)
language sql
set search_path = ''
as $$
  select *
  from private.report_verified_elimination_internal(p_killer_id);
$$;

create or replace function private.verify_elimination_internal(
  p_event_id uuid
)
returns table (
  score_points integer,
  coin_reward integer,
  killer_coins integer,
  rank_points integer,
  kills integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_killer_id uuid := (select auth.uid());
begin
  if v_killer_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  return query
  select
    e.score_points::integer,
    e.coin_reward::integer,
    p.coins,
    p.rank_points,
    p.kills
  from private.verified_eliminations e
  join public.player_profiles p on p.id = e.killer_id
  where e.id = p_event_id
    and e.killer_id = v_killer_id
    and e.created_at > now() - interval '2 minutes';
end;
$$;

create or replace function public.verify_elimination(
  p_event_id uuid
)
returns table (
  score_points integer,
  coin_reward integer,
  killer_coins integer,
  rank_points integer,
  kills integer
)
language sql
set search_path = ''
as $$
  select *
  from private.verify_elimination_internal(p_event_id);
$$;

create table if not exists private.room_items (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  room_number integer not null check (room_number > 0),
  item_type text not null check (item_type in ('push', 'speed')),
  x integer not null check (x between 80 and 2520),
  y integer not null check (y between 80 and 1720),
  spawned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);

alter table private.room_items enable row level security;
revoke all on table private.room_items
  from public, anon, authenticated;

create index if not exists room_items_active_room_idx
  on private.room_items (country_code, room_number, expires_at)
  where claimed_by is null;
create index if not exists room_items_claimed_by_idx
  on private.room_items (claimed_by)
  where claimed_by is not null;

create or replace function private.get_room_items_internal()
returns table (
  item_id uuid,
  item_type text,
  x integer,
  y integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_country text;
  v_room integer;
  v_active_count integer;
  v_last_spawn timestamptz;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  select match.country_code, match.room_number
  into v_country, v_room
  from public.public_matchmaking as match
  where match.user_id = v_user_id;

  if v_country is null then
    raise exception using
      errcode = 'P0001',
      message = 'player_not_in_active_match';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qv-room-items:' || v_country || ':' || v_room::text,
      0
    )
  );

  delete from private.room_items as old_item
  where old_item.country_code = v_country
    and old_item.room_number = v_room
    and (
      old_item.expires_at < now() - interval '5 minutes'
      or old_item.claimed_at < now() - interval '1 minute'
    );

  select count(*)::integer, max(room_item.spawned_at)
  into v_active_count, v_last_spawn
  from private.room_items as room_item
  where room_item.country_code = v_country
    and room_item.room_number = v_room
    and room_item.claimed_by is null
    and room_item.expires_at > now();

  if v_active_count < 5
    and (v_last_spawn is null or v_last_spawn < now() - interval '3 seconds')
  then
    insert into private.room_items (
      country_code,
      room_number,
      item_type,
      x,
      y,
      expires_at
    )
    values (
      v_country,
      v_room,
      case when random() < 0.5 then 'push' else 'speed' end,
      100 + floor(random() * 2400)::integer,
      100 + floor(random() * 1600)::integer,
      now() + interval '25 seconds'
    );
  end if;

  return query
  select
    room_item.id,
    room_item.item_type,
    room_item.x,
    room_item.y,
    room_item.expires_at
  from private.room_items as room_item
  where room_item.country_code = v_country
    and room_item.room_number = v_room
    and room_item.claimed_by is null
    and room_item.expires_at > now()
  order by room_item.spawned_at;
end;
$$;

create or replace function public.get_room_items()
returns table (
  item_id uuid,
  item_type text,
  x integer,
  y integer,
  expires_at timestamptz
)
language sql
set search_path = ''
as $$
  select *
  from private.get_room_items_internal();
$$;

create or replace function private.claim_room_item_internal(
  p_item_id uuid
)
returns table (
  item_id uuid,
  item_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_country text;
  v_room integer;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  select match.country_code, match.room_number
  into v_country, v_room
  from public.public_matchmaking as match
  where match.user_id = v_user_id;

  if v_country is null then
    raise exception using
      errcode = 'P0001',
      message = 'player_not_in_active_match';
  end if;

  return query
  update private.room_items as room_item
  set claimed_by = v_user_id,
      claimed_at = now()
  where room_item.id = p_item_id
    and room_item.country_code = v_country
    and room_item.room_number = v_room
    and room_item.claimed_by is null
    and room_item.expires_at > now()
  returning room_item.id, room_item.item_type;
end;
$$;

create or replace function public.claim_room_item(p_item_id uuid)
returns table (
  item_id uuid,
  item_type text
)
language sql
set search_path = ''
as $$
  select *
  from private.claim_room_item_internal(p_item_id);
$$;

revoke execute on function private.ensure_player_profile_internal(text)
  from public, anon;
revoke execute on function private.purchase_or_equip_cosmetic_internal(text, text)
  from public, anon;
revoke execute on function private.report_verified_elimination_internal(uuid)
  from public, anon;
revoke execute on function private.verify_elimination_internal(uuid)
  from public, anon;
revoke execute on function private.get_room_items_internal()
  from public, anon;
revoke execute on function private.claim_room_item_internal(uuid)
  from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.ensure_player_profile_internal(text)
  to authenticated;
grant execute on function private.purchase_or_equip_cosmetic_internal(text, text)
  to authenticated;
grant execute on function private.report_verified_elimination_internal(uuid)
  to authenticated;
grant execute on function private.verify_elimination_internal(uuid)
  to authenticated;
grant execute on function private.get_room_items_internal()
  to authenticated;
grant execute on function private.claim_room_item_internal(uuid)
  to authenticated;

revoke execute on function public.ensure_player_profile(text)
  from public, anon;
revoke execute on function public.purchase_or_equip_cosmetic(text, text)
  from public, anon;
revoke execute on function public.report_verified_elimination(uuid)
  from public, anon;
revoke execute on function public.verify_elimination(uuid)
  from public, anon;
revoke execute on function public.get_room_items()
  from public, anon;
revoke execute on function public.claim_room_item(uuid)
  from public, anon;

grant execute on function public.ensure_player_profile(text)
  to authenticated;
grant execute on function public.purchase_or_equip_cosmetic(text, text)
  to authenticated;
grant execute on function public.report_verified_elimination(uuid)
  to authenticated;
grant execute on function public.verify_elimination(uuid)
  to authenticated;
grant execute on function public.get_room_items()
  to authenticated;
grant execute on function public.claim_room_item(uuid)
  to authenticated;

revoke all on table public.public_matchmaking from anon, authenticated;
grant select on table public.public_matchmaking to authenticated;

drop policy if exists "Players can read own matchmaking ticket"
  on public.public_matchmaking;
create policy "Players can read own matchmaking ticket"
on public.public_matchmaking
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Players can receive game realtime"
  on realtime.messages;
drop policy if exists "Players can send game realtime"
  on realtime.messages;

create policy "Players can receive game realtime"
on realtime.messages
for select
to authenticated
using (
  extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.public_matchmaking as match
    where match.user_id = (select auth.uid())
      and match.last_seen >= now() - interval '60 seconds'
      and (select realtime.topic()) =
        'game:street-' || lower(match.country_code) || '-' || match.room_number
  )
);

create policy "Players can send game realtime"
on realtime.messages
for insert
to authenticated
with check (
  extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.public_matchmaking as match
    where match.user_id = (select auth.uid())
      and match.last_seen >= now() - interval '60 seconds'
      and (select realtime.topic()) =
        'game:street-' || lower(match.country_code) || '-' || match.room_number
  )
);
