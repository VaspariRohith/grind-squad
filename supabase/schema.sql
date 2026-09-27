-- =====================================================================
-- Grind Squad: full database schema
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- It is safe to run on a fresh project. It creates:
--   tables, security rules (RLS), scoring functions, voting, awards,
--   the avatar storage bucket, default activities, and 40 invite codes.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- ---------------------------------------------------------------------
-- Settings: one row. The timezone decides when "today" starts/ends.
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'America/Chicago',
  group_name text not null default 'Grind Squad',
  reports_per_day int not null default 3,
  vote_hours int not null default 24
);
insert into public.app_settings (id) values (1) on conflict do nothing;

create or replace function public.app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone (select timezone from app_settings where id = 1))::date
$$;

-- ---------------------------------------------------------------------
-- Profiles (one per user). Created automatically on sign up.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar_url text,
  bio text check (char_length(bio) <= 120),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------
create table if not exists public.invite_codes (
  code text primary key,
  note text,                                   -- who you gave it to
  created_at timestamptz not null default now(),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  revoked boolean not null default false
);

create or replace function public.gen_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I confusion
  s text := '';
  i int;
begin
  for i in 1..8 loop
    s := s || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    if i = 4 then s := s || '-'; end if;
  end loop;
  return 'GRIND-' || s;
end $$;

-- New auth user -> check + claim invite code, create profile.
-- This runs inside the same transaction as the account creation,
-- so an invalid/used code means the account is never created.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  v_username text := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  v_display text := trim(coalesce(new.raw_user_meta_data->>'display_name', ''));
  v_claimed text;
  v_first boolean;
begin
  update invite_codes
     set used_by = new.id, used_at = now()
   where code = v_code and used_by is null and not revoked
  returning code into v_claimed;

  if v_claimed is null then
    raise exception 'INVALID_INVITE_CODE';
  end if;

  select not exists (select 1 from profiles where is_admin) into v_first;

  insert into profiles (id, username, display_name, is_admin)
  values (new.id, v_username, coalesce(nullif(v_display, ''), v_username), v_first);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Categories + activities (the scoring rules; editable from Admin)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id text primary key,
  name text not null,
  icon text not null,
  color_from text not null,
  color_to text not null,
  daily_cap int not null check (daily_cap > 0),  -- max points per day (for negatives: max penalty)
  is_negative boolean not null default false,
  sort int not null default 0
);

create table if not exists public.activities (
  id text primary key,
  category_id text not null references public.categories(id) on delete cascade,
  name text not null,
  hint text,
  icon text not null,
  kind text not null check (kind in ('check', 'count', 'choice', 'band')),
  points int not null default 0,   -- check: points; count: points per step; choice: unused
  unit text,                        -- count: e.g. 'min', 'serving'
  step numeric not null default 1,  -- count: how much one step is (30 min)
  max_value numeric,                -- count: highest value that still earns points
  log_max numeric,                  -- count/band: highest value you can log at all
  options jsonb,                    -- choice: [{"label":"7-9h","points":15}, ...]
                                    -- band:   [{"from":420,"label":"7–9h","points":15}, ...]
  sort int not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------------------
-- Logs: one row per user + day + activity
-- ---------------------------------------------------------------------
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  activity_id text not null references public.activities(id) on delete cascade,
  category_id text not null references public.categories(id) on delete cascade,
  value numeric not null default 1,
  points int not null default 0,
  is_negative boolean not null default false,
  voided boolean not null default false,       -- removed by a vote or the admin
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day, activity_id)
);
create index if not exists logs_day_idx on public.logs (day);
create index if not exists logs_user_day_idx on public.logs (user_id, day);

-- Points for a value of an activity (snapshot at the time of logging)
create or replace function public.activity_points(a public.activities, v numeric) returns int
language plpgsql stable set search_path = public as $$
declare
  n int;
  sign int := 1;
  cat_neg boolean;
begin
  select is_negative into cat_neg from categories where id = a.category_id;
  if cat_neg then sign := -1; end if;
  if a.kind = 'check' then
    return sign * abs(a.points);
  elsif a.kind = 'count' then
    n := floor(least(v, coalesce(a.max_value, v)) / nullif(a.step, 0));
    return sign * abs(a.points) * coalesce(n, 0);
  elsif a.kind = 'band' then
    -- band: the value falls into the highest band whose "from" it has reached
    if v <= 0 or a.options is null then return 0; end if;
    select (o ->> 'points')::int into n
      from jsonb_array_elements(a.options) o
     where (o ->> 'from')::numeric <= v
     order by (o ->> 'from')::numeric desc
     limit 1;
    return sign * abs(coalesce(n, 0));
  else
    -- choice: value 1 = first option, 2 = second, ... (0 = nothing picked)
    if a.options is null or v < 1 or v > jsonb_array_length(a.options) then return 0; end if;
    return sign * abs(coalesce((a.options -> (v::int - 1) ->> 'points')::int, 0));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Freezes (cheat days / trips). Requested by a user, approved by admin.
-- ---------------------------------------------------------------------
create table if not exists public.freezes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_day date not null,
  end_day date not null,
  reason text check (char_length(reason) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_day >= start_day and end_day - start_day <= 30)
);

create or replace function public.is_frozen(p_user uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from freezes where user_id = p_user and status = 'approved'
                 and p_day between start_day and end_day)
$$;

-- ---------------------------------------------------------------------
-- Admin point adjustments (separate entries; visible to everyone)
-- ---------------------------------------------------------------------
create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default public.app_today(),
  points int not null check (points <> 0 and points between -500 and 500),
  reason text not null check (char_length(reason) between 2 and 200),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reports + anonymous votes
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  note text not null check (char_length(note) between 2 and 280),
  round int not null default 1,
  remove_votes int not null default 0,
  keep_votes int not null default 0,
  status text not null default 'open'
    check (status in ('open', 'removed', 'kept', 'dismissed', 'admin_review')),
  outcome_note text,
  closes_at timestamptz not null,
  created_day date not null default public.app_today(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists one_open_report_per_log
  on public.reports (log_id) where status in ('open', 'admin_review');

create table if not exists public.report_votes (
  report_id uuid not null references public.reports(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  round int not null,
  vote text not null check (vote in ('remove', 'keep')),
  created_at timestamptz not null default now(),
  primary key (report_id, voter_id, round)
);

-- ---------------------------------------------------------------------
-- Awards (monthly + yearly champions and last place)
-- ---------------------------------------------------------------------
create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('month_champion', 'month_last', 'year_champion', 'year_last')),
  period text not null,          -- '2026-10' or '2026'
  title text not null,
  points int not null,
  created_at timestamptz not null default now(),
  unique (kind, period, user_id)
);
create table if not exists public.award_periods (
  period text primary key,
  finalized_at timestamptz not null default now()
);

-- =====================================================================
-- SCORING
-- =====================================================================
-- Daily points per user. Category caps apply per day. Frozen days = 0
-- (admin adjustments still count). log_points excludes adjustments.
create or replace function public.daily_points(p_from date, p_to date, p_user uuid default null)
returns table (user_id uuid, day date, points int, log_points int, frozen boolean)
language sql stable security definer set search_path = public as $$
  with cat as (
    select l.user_id, l.day, l.category_id, sum(l.points) as pts
      from logs l
     where not l.voided and l.day between p_from and p_to
       and (p_user is null or l.user_id = p_user)
     group by 1, 2, 3
  ), capped as (
    select c.user_id, c.day,
           sum(case when k.is_negative then greatest(c.pts, -k.daily_cap)
                    else least(c.pts, k.daily_cap) end)::int as pts
      from cat c join categories k on k.id = c.category_id
     group by 1, 2
  ), adj as (
    select a.user_id, a.day, sum(a.points)::int as pts
      from adjustments a
     where a.day between p_from and p_to and (p_user is null or a.user_id = p_user)
     group by 1, 2
  ), fr as (
    select distinct f.user_id, g::date as day
      from freezes f
      cross join lateral generate_series(greatest(f.start_day, p_from), least(f.end_day, p_to), interval '1 day') g
     where f.status = 'approved' and (p_user is null or f.user_id = p_user)
  ), keys as (
    select c.user_id, c.day from capped c
    union select a.user_id, a.day from adj a
    union select f.user_id, f.day from fr f
  )
  select k.user_id, k.day,
         (case when f.user_id is not null then 0 else coalesce(c.pts, 0) end + coalesce(a.pts, 0))::int,
         (case when f.user_id is not null then 0 else coalesce(c.pts, 0) end)::int,
         f.user_id is not null
    from keys k
    left join capped c on c.user_id = k.user_id and c.day = k.day
    left join adj a on a.user_id = k.user_id and a.day = k.day
    left join fr f on f.user_id = k.user_id and f.day = k.day
$$;

-- Streaks. A "streak day" = not frozen and logged points > 0.
-- Frozen days are skipped (they neither break nor extend a streak).
-- Today not logged yet does not break the streak.
create or replace function public.streaks(p_user uuid)
returns table (current_streak int, best_streak int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date;
  v_today date := app_today();
  r record;
  run int := 0;
  best int := 0;
begin
  select min(l.day) into v_start from logs l where l.user_id = p_user and not l.voided;
  if v_start is null then
    return query select 0, 0; return;
  end if;
  for r in
    select g::date as d, coalesce(dp.log_points, 0) as lp, coalesce(dp.frozen, false) as fz
      from generate_series(v_start, v_today, interval '1 day') g
      left join daily_points(v_start, v_today, p_user) dp on dp.day = g::date
     order by 1
  loop
    if r.fz then
      continue;
    elsif r.lp > 0 then
      run := run + 1;
      best := greatest(best, run);
    elsif r.d = v_today then
      continue;
    else
      run := 0;
    end if;
  end loop;
  return query select run, best;
end $$;

-- Leaderboard for any date range (net points; negatives are included
-- in the number but never shown item by item).
create or replace function public.leaderboard(p_from date, p_to date)
returns table (user_id uuid, username text, display_name text, avatar_url text,
               points int, days_logged int, frozen_days int, current_streak int, best_streak int, rank int)
language sql stable security definer set search_path = public as $$
  with d as (select * from daily_points(p_from, p_to)),
  agg as (
    select p.id,
           coalesce(sum(d.points), 0)::int as pts,
           (select count(distinct l.day) from logs l
             where l.user_id = p.id and not l.voided and l.day between p_from and p_to)::int as days_logged,
           count(*) filter (where d.frozen)::int as frozen_days
      from profiles p left join d on d.user_id = p.id
     group by p.id
  )
  select p.id, p.username, p.display_name, p.avatar_url, a.pts, a.days_logged, a.frozen_days,
         s.current_streak, s.best_streak,
         rank() over (order by a.pts desc)::int
    from agg a join profiles p on p.id = a.id
    cross join lateral streaks(p.id) s
   where auth.uid() is not null
   order by a.pts desc, p.display_name
$$;

-- Personal stats for a profile page
create or replace function public.profile_stats(p_user uuid)
returns table (total_points int, month_points int, year_points int, days_logged int,
               current_streak int, best_streak int)
language sql stable security definer set search_path = public as $$
  select
    (select coalesce(sum(points), 0) from daily_points('2000-01-01', app_today(), p_user))::int,
    (select coalesce(sum(points), 0) from daily_points(date_trunc('month', app_today())::date, app_today(), p_user))::int,
    (select coalesce(sum(points), 0) from daily_points(date_trunc('year', app_today())::date, app_today(), p_user))::int,
    (select count(distinct day) from logs where user_id = p_user and not voided)::int,
    s.current_streak, s.best_streak
  from streaks(p_user) s
  where auth.uid() is not null
$$;

-- =====================================================================
-- LOGGING (only today + yesterday, only for yourself, not on frozen days)
-- =====================================================================
create or replace function public.set_log(p_day date, p_activity text, p_value numeric)
returns public.logs
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := app_today();
  a activities;
  v_existing logs;
  v_row logs;
  v_neg boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_day < v_today - 1 or p_day > v_today then
    raise exception 'You can only log today or yesterday';
  end if;
  if is_frozen(v_uid, p_day) then raise exception 'This day is frozen'; end if;

  select * into a from activities where id = p_activity and active;
  if a.id is null then raise exception 'Unknown activity'; end if;
  select is_negative into v_neg from categories where id = a.category_id;

  select * into v_existing from logs where user_id = v_uid and day = p_day and activity_id = p_activity;
  if v_existing.voided then raise exception 'This entry was removed by a vote and is locked'; end if;

  if p_value is null or p_value <= 0 then
    delete from logs where id = v_existing.id;
    return null;
  end if;

  if a.log_max is not null and p_value > a.log_max then
    raise exception 'That is more than the max for %', a.name;
  end if;

  -- Everything logged in minutes (study + sleep) must fit in one day
  if a.unit = 'min' and p_value + coalesce((
      select sum(l.value) from logs l join activities x on x.id = l.activity_id
       where l.user_id = v_uid and l.day = p_day and x.unit = 'min' and l.activity_id <> p_activity), 0) > 1440 then
    raise exception 'Study and sleep together can''t be more than 24 hours';
  end if;

  insert into logs (user_id, day, activity_id, category_id, value, points, is_negative)
  values (v_uid, p_day, p_activity, a.category_id, p_value, activity_points(a, p_value), v_neg)
  on conflict (user_id, day, activity_id) do update
     set value = excluded.value, points = excluded.points, updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- =====================================================================
-- FREEZES
-- =====================================================================
create or replace function public.request_freeze(p_start date, p_end date, p_reason text)
returns public.freezes
language plpgsql security definer set search_path = public as $$
declare v_row freezes;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_start < app_today() - 1 then raise exception 'Freeze can start yesterday at the earliest'; end if;
  insert into freezes (user_id, start_day, end_day, reason)
  values (auth.uid(), p_start, p_end, nullif(trim(p_reason), ''))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.admin_decide_freeze(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update freezes set status = case when p_approve then 'approved' else 'denied' end, decided_at = now()
   where id = p_id;
end $$;

create or replace function public.admin_create_freeze(p_user uuid, p_start date, p_end date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  insert into freezes (user_id, start_day, end_day, reason, status, decided_at)
  values (p_user, p_start, p_end, nullif(trim(p_reason), ''), 'approved', now());
end $$;

-- =====================================================================
-- REPORTS + VOTING
-- Rules:
--  * max 3 reports per person per day, can't report your own entry
--  * the reporter's report counts as their "remove" vote
--  * everyone except the reported person can vote; votes are anonymous
--  * voting closes when everyone voted or after 24h
--  * at least half of the voters must vote, otherwise the entry stays
--  * more "remove" -> entry voided; more "keep" -> entry stays
--  * tie -> one revote round; tie again -> admin decides
-- =====================================================================
create or replace function public.try_resolve_report(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r reports;
  v_eligible int;
  v_quorum int;
  v_total int;
begin
  select * into r from reports where id = p_id for update;
  if r.status <> 'open' then return; end if;

  select count(*) into v_eligible from profiles where id <> r.reported_user_id;
  v_quorum := ceil(v_eligible / 2.0);
  v_total := r.remove_votes + r.keep_votes;

  if v_total < v_eligible and now() < r.closes_at then
    return; -- still open
  end if;

  if v_total < v_quorum then
    update reports set status = 'dismissed', resolved_at = now(),
           outcome_note = 'Not enough votes. The entry stays.' where id = p_id;
  elsif r.remove_votes > r.keep_votes then
    update reports set status = 'removed', resolved_at = now(),
           outcome_note = 'Voted out. Points removed.' where id = p_id;
    update logs set voided = true where id = r.log_id;
  elsif r.keep_votes > r.remove_votes then
    update reports set status = 'kept', resolved_at = now(),
           outcome_note = 'Voted to keep. The entry stays.' where id = p_id;
  elsif r.round = 1 then
    update reports set round = 2, remove_votes = 0, keep_votes = 0,
           closes_at = now() + make_interval(hours => (select vote_hours from app_settings where id = 1))
     where id = p_id;
  else
    update reports set status = 'admin_review',
           outcome_note = 'Tied twice. The admin decides.' where id = p_id;
  end if;
end $$;

create or replace function public.resolve_due_reports()
returns void language plpgsql security definer set search_path = public as $$
declare x record;
begin
  for x in select id from reports where status = 'open' and closes_at <= now() loop
    perform try_resolve_report(x.id);
  end loop;
end $$;

create or replace function public.create_report(p_log uuid, p_note text)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l logs;
  v_used int;
  v_limit int;
  v_row reports;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into l from logs where id = p_log;
  if l.id is null or l.is_negative then raise exception 'Entry not found'; end if;
  if l.user_id = v_uid then raise exception 'You cannot report your own entry'; end if;
  if l.voided then raise exception 'This entry was already removed'; end if;
  if l.day < app_today() - 6 then raise exception 'Only entries from the last 7 days can be reported'; end if;
  if exists (select 1 from reports where log_id = p_log and status in ('open', 'admin_review')) then
    raise exception 'This entry already has an open report';
  end if;

  select reports_per_day into v_limit from app_settings where id = 1;
  select count(*) into v_used from reports where reporter_id = v_uid and created_day = app_today();
  if v_used >= v_limit then raise exception 'You used all % reports for today', v_limit; end if;

  insert into reports (log_id, reporter_id, reported_user_id, note, closes_at, remove_votes)
  values (p_log, v_uid, l.user_id, trim(p_note),
          now() + make_interval(hours => (select vote_hours from app_settings where id = 1)), 1)
  returning * into v_row;
  insert into report_votes (report_id, voter_id, round, vote) values (v_row.id, v_uid, 1, 'remove');

  perform try_resolve_report(v_row.id);
  select * into v_row from reports where id = v_row.id;
  return v_row;
end $$;

create or replace function public.cast_vote(p_report uuid, p_vote text)
returns public.reports
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r reports;
  v_old text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_vote not in ('remove', 'keep') then raise exception 'Bad vote'; end if;
  select * into r from reports where id = p_report for update;
  if r.id is null or r.status <> 'open' then raise exception 'Voting is closed'; end if;
  if r.reported_user_id = v_uid then raise exception 'You cannot vote on your own entry'; end if;

  select vote into v_old from report_votes where report_id = p_report and voter_id = v_uid and round = r.round;
  if v_old = p_vote then return r; end if;

  insert into report_votes (report_id, voter_id, round, vote) values (p_report, v_uid, r.round, p_vote)
  on conflict (report_id, voter_id, round) do update set vote = excluded.vote, created_at = now();

  update reports set
    remove_votes = remove_votes + (case when p_vote = 'remove' then 1 else 0 end)
                                - (case when v_old = 'remove' then 1 else 0 end),
    keep_votes   = keep_votes + (case when p_vote = 'keep' then 1 else 0 end)
                              - (case when v_old = 'keep' then 1 else 0 end)
   where id = p_report;

  perform try_resolve_report(p_report);
  select * into r from reports where id = p_report;
  return r;
end $$;

create or replace function public.my_votes()
returns table (report_id uuid, round int, vote text)
language sql stable security definer set search_path = public as $$
  select report_id, round, vote from report_votes where voter_id = auth.uid()
$$;

create or replace function public.reports_left_today()
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, (select reports_per_day from app_settings where id = 1)
    - (select count(*)::int from reports where reporter_id = auth.uid() and created_day = app_today()))
$$;

create or replace function public.admin_decide_report(p_id uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from reports where id = p_id;
  update reports set status = case when p_remove then 'removed' else 'kept' end,
         resolved_at = now(),
         outcome_note = case when p_remove then 'Admin removed the entry.' else 'Admin kept the entry.' end
   where id = p_id;
  update logs set voided = p_remove where id = r.log_id;
end $$;

-- =====================================================================
-- AWARDS
-- Finalized lazily: the app calls finalize_awards() when the board
-- opens. Completed months/years get their awards exactly once.
-- Eligible: joined in the first 7 days of the month (first 31 days of
-- the year). Anyone with 7+ frozen days in the month (30+ in the year)
-- can't get last place. Last place needs 3+ eligible people.
-- =====================================================================
create or replace function public.period_scores(p_from date, p_to date, p_join_cutoff date)
returns table (user_id uuid, pts int, frozen int)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(sum(d.points), 0)::int, (count(*) filter (where d.frozen))::int
    from profiles p
    left join daily_points(p_from, p_to) d on d.user_id = p.id
   where p.created_at::date <= p_join_cutoff
   group by p.id
$$;

create or replace function public.award_period(p_from date, p_to date, p_period text, p_is_year boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  m int := extract(month from p_from);
  champ_titles text[] := array['New Year Beast','Cupid of Gains','March Madness MVP','April Apex',
    'May Day Machine','June Juggernaut','Firecracker of July','August Emperor','September Sensei',
    'Spooky Season Slayer','Thanks-Gainer','Holiday GOAT'];
  last_titles text[] := array['Resolution Dropout','Lonely Lazybones','Spring Snoozer','April Fool',
    'Mayday Mayday','Summer Couch Potato','Melted Popsicle','Dog Days Doormat','Back-to-Snooze',
    'The Walking Dead','Stuffed Turkey','Lump of Coal'];
  v_champ text;
  v_last text;
  v_join_cutoff date := p_from + (case when p_is_year then 30 else 6 end);
  v_frozen_limit int := case when p_is_year then 30 else 7 end;
  v_count int;
  v_max int;
  v_min int;
begin
  if p_is_year then
    v_champ := 'Grind Lord of the Year';
    v_last := 'Sloth of the Year';
  else
    v_champ := champ_titles[m];
    v_last := last_titles[m];
  end if;

  select count(*), max(pts) into v_count, v_max
    from period_scores(p_from, p_to, v_join_cutoff);
  if v_count >= 2 and v_max > 0 then
    insert into awards (user_id, kind, period, title, points)
    select s.user_id, case when p_is_year then 'year_champion' else 'month_champion' end, p_period, v_champ, s.pts
      from period_scores(p_from, p_to, v_join_cutoff) s where s.pts = v_max
    on conflict do nothing;

    select count(*), min(pts) into v_count, v_min
      from period_scores(p_from, p_to, v_join_cutoff) where frozen < v_frozen_limit;
    if v_count >= 3 and v_min < v_max then
      insert into awards (user_id, kind, period, title, points)
      select s.user_id, case when p_is_year then 'year_last' else 'month_last' end, p_period, v_last, s.pts
        from period_scores(p_from, p_to, v_join_cutoff) s
       where s.pts = v_min and s.frozen < v_frozen_limit
      on conflict do nothing;
    end if;
  end if;
  insert into award_periods (period) values (p_period) on conflict do nothing;
end $$;

create or replace function public.finalize_awards()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_first date;
  v_today date := app_today();
  m date;
  y int;
begin
  select min(day) into v_first from logs;
  if v_first is null then return; end if;
  for m in select generate_series(date_trunc('month', v_first), date_trunc('month', v_today) - interval '1 month', interval '1 month')::date loop
    if not exists (select 1 from award_periods where period = to_char(m, 'YYYY-MM')) then
      perform award_period(m, (m + interval '1 month' - interval '1 day')::date, to_char(m, 'YYYY-MM'), false);
    end if;
  end loop;
  for y in select generate_series(extract(year from v_first)::int, extract(year from v_today)::int - 1) loop
    if not exists (select 1 from award_periods where period = y::text) then
      perform award_period(make_date(y, 1, 1), make_date(y, 12, 31), y::text, true);
    end if;
  end loop;
end $$;

-- =====================================================================
-- ADMIN helpers
-- =====================================================================
create or replace function public.admin_generate_invites(p_count int, p_note text default null)
returns setof public.invite_codes
language plpgsql security definer set search_path = public as $$
declare i int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_count < 1 or p_count > 50 then raise exception 'Between 1 and 50 at a time'; end if;
  for i in 1..p_count loop
    return query insert into invite_codes (code, note) values (gen_invite_code(), p_note)
      on conflict do nothing returning *;
  end loop;
end $$;

create or replace function public.admin_set_admin(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_user = auth.uid() and not p_admin then raise exception 'You cannot remove your own admin'; end if;
  update profiles set is_admin = p_admin where id = p_user;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- Every table is locked by default. Writes that need rules go through
-- the functions above (which check who you are).
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.categories enable row level security;
alter table public.activities enable row level security;
alter table public.logs enable row level security;
alter table public.freezes enable row level security;
alter table public.adjustments enable row level security;
alter table public.reports enable row level security;
alter table public.report_votes enable row level security;
alter table public.awards enable row level security;
alter table public.award_periods enable row level security;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;

-- Explicit table access for signed-in users (row rules below still apply).
-- Written out so it works even if "automatically expose new tables" is off.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.invite_codes to authenticated;
grant update on public.app_settings, public.categories, public.activities to authenticated;
grant insert, delete on public.adjustments to authenticated;
grant delete on public.freezes to authenticated;

-- Settings
drop policy if exists "read settings" on public.app_settings;
create policy "read settings" on public.app_settings for select to authenticated using (true);
drop policy if exists "admin edits settings" on public.app_settings;
create policy "admin edits settings" on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profiles: everyone signed in can see everyone; you edit only your own
-- name/photo/bio (column grants below stop edits to is_admin/username).
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, bio) on public.profiles to authenticated;

-- Invite codes: admin only
drop policy if exists "admin invites" on public.invite_codes;
create policy "admin invites" on public.invite_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Rules: everyone reads, admin edits
drop policy if exists "read categories" on public.categories;
create policy "read categories" on public.categories for select to authenticated using (true);
drop policy if exists "admin categories" on public.categories;
create policy "admin categories" on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "read activities" on public.activities;
create policy "read activities" on public.activities for select to authenticated using (true);
drop policy if exists "admin activities" on public.activities;
create policy "admin activities" on public.activities for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Logs: read-only through the API. Negative items (junk, alcohol, ...)
-- are visible only to their owner and the admin. Writes via set_log().
drop policy if exists "read logs" on public.logs;
create policy "read logs" on public.logs for select to authenticated
  using (user_id = auth.uid() or not is_negative or public.is_admin());
revoke insert, update, delete on public.logs from authenticated;

-- Freezes: everyone sees them; you can cancel your own pending request.
drop policy if exists "read freezes" on public.freezes;
create policy "read freezes" on public.freezes for select to authenticated using (true);
drop policy if exists "cancel own pending freeze" on public.freezes;
create policy "cancel own pending freeze" on public.freezes for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
revoke insert, update on public.freezes from authenticated;

-- Adjustments: everyone reads (transparency), admin writes
drop policy if exists "read adjustments" on public.adjustments;
create policy "read adjustments" on public.adjustments for select to authenticated using (true);
drop policy if exists "admin adjustments" on public.adjustments;
create policy "admin adjustments" on public.adjustments for insert to authenticated
  with check (public.is_admin());
drop policy if exists "admin delete adjustments" on public.adjustments;
create policy "admin delete adjustments" on public.adjustments for delete to authenticated
  using (public.is_admin());

-- Reports: everyone reads; writes via functions. Votes are private.
drop policy if exists "read reports" on public.reports;
create policy "read reports" on public.reports for select to authenticated using (true);
revoke insert, update, delete on public.reports from authenticated;
revoke all on public.report_votes from authenticated;

-- Awards: everyone reads
drop policy if exists "read awards" on public.awards;
create policy "read awards" on public.awards for select to authenticated using (true);
revoke insert, update, delete on public.awards, public.award_periods from authenticated;

-- =====================================================================
-- Avatar storage (public bucket, 1 MB max, you can only write your folder)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Uploads read the saved row back, so signed-in users need read access too
drop policy if exists "avatar read" on storage.objects;
create policy "avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
drop policy if exists "avatar insert own" on storage.objects;
create policy "avatar insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar update own" on storage.objects;
create policy "avatar update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete own" on storage.objects;
create policy "avatar delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- Default scoring rules. Max positive per day = 100.
-- =====================================================================
insert into public.categories (id, name, icon, color_from, color_to, daily_cap, is_negative, sort) values
  ('skincare',  'Skincare',  'sparkles', '#FF5FA2', '#FF9A6B', 10, false, 1),
  ('fitness',   'Fitness',   'dumbbell', '#FF7A1A', '#FF2E4D', 30, false, 2),
  ('nutrition', 'Nutrition', 'apple',    '#1FD17A', '#B6F03C', 20, false, 3),
  ('study',     'Study',     'book',     '#3B82F6', '#22D3EE', 20, false, 4),
  ('sleep',     'Sleep',     'moon',     '#8B5CF6', '#C084FC', 20, false, 5),
  ('vices',     'Slip-ups',  'skull',    '#F43F5E', '#991B1B', 40, true,  6)
on conflict (id) do nothing;

insert into public.activities (id, category_id, name, hint, icon, kind, points, unit, step, max_value, options, sort) values
  ('skin_am',     'skincare',  'Morning routine',     'Cleanse + moisturize',   'sun',        'check', 4, null, 1, null, null, 1),
  ('skin_pm',     'skincare',  'Night routine',       'Cleanse + treat',        'moon-star',  'check', 4, null, 1, null, null, 2),
  ('sunscreen',   'skincare',  'Sunscreen',           'SPF before going out',   'sun-medium', 'check', 2, null, 1, null, null, 3),
  ('gym',         'fitness',   'Workout',             'Gym or home, 30+ min',   'dumbbell',   'check', 15, null, 1, null, null, 1),
  ('run',         'fitness',   'Run or 10k steps',    'A 2+ km run or 10,000 steps', 'footprints', 'check', 15, null, 1, null, null, 2),
  ('protein',     'nutrition', 'Hit calorie/diet goal', 'Stuck to your plan today', 'target',   'check', 10, null, 1, null, null, 1),
  ('water',       'nutrition', '3L water',            null,                     'droplets',   'check', 5, null, 1, null, null, 2),
  ('homecooked',  'nutrition', 'Home-cooked meal',    null,                     'chef-hat',   'check', 5, null, 1, null, null, 3),
  ('study_time',  'study',     'Study',               'Anything, at least 30 min', 'book',     'check', 20, null, 1, null, null, 1),
  ('sleep_hours', 'sleep',     'Hours slept',         '7–9h is the sweet spot', 'bed',        'band', 0, 'min', 30, null,
     '[{"from":0,"label":"0–3h","points":0},{"from":240,"label":"4–6h","points":8},{"from":420,"label":"7–9h","points":15},{"from":570,"label":"9h+","points":10}]', 1),
  ('bedtime',     'sleep',     'In bed on time',      'Before your target time', 'alarm-clock','check', 5, null, 1, null, null, 2),
  ('junk',        'vices',     'Junk food',           '-5 per serving',         'pizza',      'count', 5, 'serving', 1, 3, null, 1),
  ('alcohol',     'vices',     'Alcohol',             null,                     'wine',       'check', 10, null, 1, null, null, 2),
  ('smoke',       'vices',     'Smoked',              null,                     'cigarette',  'check', 10, null, 1, null, null, 3),
  ('weed',        'vices',     'Weed',                null,                     'leaf',       'check', 10, null, 1, null, null, 4)
on conflict (id) do nothing;

-- How much can be logged at most (points still stop at the caps above)
update public.activities set log_max = 960 where id = 'sleep_hours'; -- 16 hours
update public.activities set log_max = 10 where id = 'junk';

-- 40 starter invite codes (random; see them in the Admin tab)
insert into public.invite_codes (code)
select public.gen_invite_code() from generate_series(1, 40)
on conflict do nothing;
