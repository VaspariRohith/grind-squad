-- =====================================================================
-- 009: every member's day follows their own timezone.
--   * profiles.timezone (set automatically from the phone on first open;
--     only the admin can change it afterwards)
--   * logging window, streaks, freezes, report limits and profile stats
--     use the member's own "today"
--   * monthly/yearly awards wait until the period is over for everyone
-- Safe to run more than once.
-- =====================================================================

alter table public.profiles add column if not exists timezone text;

create or replace function public.tz_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from profiles where id = p_user),
                  (select timezone from app_settings where id = 1))
$$;

create or replace function public.user_today(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone tz_of(p_user))::date
$$;

create or replace function public.my_today() returns date
language sql stable security definer set search_path = public as $$
  select user_today(auth.uid())
$$;

create or replace function public.streaks(p_user uuid)
returns table (current_streak int, best_streak int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date;
  v_today date := user_today(p_user);
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

create or replace function public.profile_stats(p_user uuid)
returns table (total_points int, month_points int, year_points int, days_logged int,
               current_streak int, best_streak int)
language sql stable security definer set search_path = public as $$
  select
    (select coalesce(sum(points), 0) from daily_points('2000-01-01', user_today(p_user), p_user))::int,
    (select coalesce(sum(points), 0) from daily_points(date_trunc('month', user_today(p_user))::date, user_today(p_user), p_user))::int,
    (select coalesce(sum(points), 0) from daily_points(date_trunc('year', user_today(p_user))::date, user_today(p_user), p_user))::int,
    (select count(distinct day) from logs where user_id = p_user and not voided)::int,
    s.current_streak, s.best_streak
  from streaks(p_user) s
  where auth.uid() is not null
$$;

create or replace function public.set_log(p_day date, p_activity text, p_value numeric)
returns public.logs
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := user_today(v_uid);
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

create or replace function public.request_freeze(p_start date, p_end date, p_reason text)
returns public.freezes
language plpgsql security definer set search_path = public as $$
declare v_row freezes;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_start < user_today(auth.uid()) - 1 then raise exception 'Freeze can start yesterday at the earliest'; end if;
  insert into freezes (user_id, start_day, end_day, reason)
  values (auth.uid(), p_start, p_end, nullif(trim(p_reason), ''))
  returning * into v_row;
  return v_row;
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
  if l.day < user_today(v_uid) - 6 then raise exception 'Only entries from the last 7 days can be reported'; end if;
  if exists (select 1 from reports where log_id = p_log and status in ('open', 'admin_review')) then
    raise exception 'This entry already has an open report';
  end if;

  select reports_per_day into v_limit from app_settings where id = 1;
  select count(*) into v_used from reports where reporter_id = v_uid and created_day = user_today(v_uid);
  if v_used >= v_limit then raise exception 'You used all % reports for today', v_limit; end if;

  insert into reports (log_id, reporter_id, reported_user_id, note, created_day, closes_at, remove_votes)
  values (p_log, v_uid, l.user_id, trim(p_note), user_today(v_uid),
          now() + make_interval(hours => (select vote_hours from app_settings where id = 1)), 1)
  returning * into v_row;
  insert into report_votes (report_id, voter_id, round, vote) values (v_row.id, v_uid, 1, 'remove');

  perform try_resolve_report(v_row.id);
  select * into v_row from reports where id = v_row.id;
  return v_row;
end $$;

create or replace function public.reports_left_today()
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, (select reports_per_day from app_settings where id = 1)
    - (select count(*)::int from reports where reporter_id = auth.uid() and created_day = user_today(auth.uid())))
$$;

create or replace function public.finalize_awards()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_first date;
  -- a month is over only when it is over for everyone (the member furthest behind in time)
  v_today date := least(app_today(), (select min(user_today(id)) from profiles));
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

create or replace function public.set_my_timezone(p_tz text)
returns text language plpgsql security definer set search_path = public as $$
declare v_now text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown timezone'; end if;
  update profiles set timezone = p_tz where id = auth.uid() and timezone is null;
  select timezone into v_now from profiles where id = auth.uid();
  return v_now;
end $$;

create or replace function public.admin_set_timezone(p_user uuid, p_tz text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown timezone'; end if;
  update profiles set timezone = p_tz where id = p_user;
end $$;

revoke execute on function public.tz_of(uuid) from anon, public;
grant execute on function public.tz_of(uuid) to authenticated;
revoke execute on function public.user_today(uuid) from anon, public;
grant execute on function public.user_today(uuid) to authenticated;
revoke execute on function public.my_today() from anon, public;
grant execute on function public.my_today() to authenticated;
revoke execute on function public.streaks(uuid) from anon, public;
grant execute on function public.streaks(uuid) to authenticated;
revoke execute on function public.profile_stats(uuid) from anon, public;
grant execute on function public.profile_stats(uuid) to authenticated;
revoke execute on function public.set_log(date, text, numeric) from anon, public;
grant execute on function public.set_log(date, text, numeric) to authenticated;
revoke execute on function public.request_freeze(date, date, text) from anon, public;
grant execute on function public.request_freeze(date, date, text) to authenticated;
revoke execute on function public.create_report(uuid, text) from anon, public;
grant execute on function public.create_report(uuid, text) to authenticated;
revoke execute on function public.reports_left_today() from anon, public;
grant execute on function public.reports_left_today() to authenticated;
revoke execute on function public.finalize_awards() from anon, public;
grant execute on function public.finalize_awards() to authenticated;
revoke execute on function public.set_my_timezone(text) from anon, public;
grant execute on function public.set_my_timezone(text) to authenticated;
revoke execute on function public.admin_set_timezone(uuid, text) from anon, public;
grant execute on function public.admin_set_timezone(uuid, text) to authenticated;
