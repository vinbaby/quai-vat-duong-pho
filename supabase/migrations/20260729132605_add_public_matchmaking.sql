create table public.public_matchmaking (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  room_number integer not null check (room_number > 0),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.public_matchmaking enable row level security;
revoke all on table public.public_matchmaking from anon, authenticated;

create index public_matchmaking_room_activity_idx
  on public.public_matchmaking (country_code, room_number, last_seen);

create or replace function public.join_public_match(p_country_code text default 'GL')
returns table (
  assigned_country text,
  assigned_room integer,
  room_capacity integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  normalized_country text := upper(coalesce(p_country_code, 'GL'));
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  if normalized_country !~ '^[A-Z]{2}$' then
    normalized_country := 'GL';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('qv-public-match:' || normalized_country, 0)
  );

  delete from public.public_matchmaking
  where country_code = normalized_country
    and last_seen < now() - interval '60 seconds';

  delete from public.public_matchmaking
  where user_id = requesting_user
    and country_code <> normalized_country;

  select match.room_number
    into assigned_room
  from public.public_matchmaking as match
  where match.user_id = requesting_user;

  if assigned_room is not null then
    update public.public_matchmaking
    set last_seen = now()
    where user_id = requesting_user;

    assigned_country := normalized_country;
    room_capacity := 20;
    return next;
    return;
  end if;

  select available.room_number
    into assigned_room
  from (
    select match.room_number, count(*) as player_count
    from public.public_matchmaking as match
    where match.country_code = normalized_country
    group by match.room_number
  ) as available
  where available.player_count < 20
  order by available.room_number
  limit 1;

  if assigned_room is null then
    select coalesce(max(match.room_number), 0) + 1
      into assigned_room
    from public.public_matchmaking as match
    where match.country_code = normalized_country;
  end if;

  insert into public.public_matchmaking (
    user_id,
    country_code,
    room_number
  )
  values (
    requesting_user,
    normalized_country,
    assigned_room
  )
  on conflict (user_id) do update
  set country_code = excluded.country_code,
      room_number = excluded.room_number,
      joined_at = now(),
      last_seen = now();

  assigned_country := normalized_country;
  room_capacity := 20;
  return next;
end;
$$;

create or replace function public.heartbeat_public_match()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.public_matchmaking
  set last_seen = now()
  where user_id = auth.uid();

  return found;
end;
$$;

create or replace function public.leave_public_match()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  delete from public.public_matchmaking
  where user_id = auth.uid();

  return found;
end;
$$;

revoke execute on function public.join_public_match(text) from public, anon;
revoke execute on function public.heartbeat_public_match() from public, anon;
revoke execute on function public.leave_public_match() from public, anon;

grant execute on function public.join_public_match(text) to authenticated;
grant execute on function public.heartbeat_public_match() to authenticated;
grant execute on function public.leave_public_match() to authenticated;
