-- =====================================================================
-- 002: study up to 16h, sleep as an hour clock with score bands,
--      study + sleep capped at 24h per day.
-- Only needed on databases created before this change. Fresh installs
-- get all of this from schema.sql. Safe to run more than once.
-- =====================================================================

alter table public.activities add column if not exists log_max numeric;
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('check', 'count', 'choice', 'band'));

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

-- Convert sleep entries logged with the old 4 buttons into minutes
update public.logs set value = case value::int when 1 then 300 when 2 then 390 when 3 then 480 when 4 then 600 else value end
 where activity_id = 'sleep_hours' and value <= 4;

update public.activities set
  kind = 'band', unit = 'min', step = 30, points = 0, max_value = null,
  hint = '7–9h is the sweet spot',
  options = '[{"from":0,"label":"0–3h","points":0},{"from":240,"label":"4–6h","points":8},{"from":420,"label":"7–9h","points":15},{"from":570,"label":"9h+","points":10}]'
 where id = 'sleep_hours';
update public.activities set hint = null where id = 'study_time';
update public.activities set log_max = 960 where id in ('study_time', 'sleep_hours');
update public.activities set log_max = 10 where id = 'junk';

-- Recalculate points for the converted sleep entries
update public.logs l set points = public.activity_points(a, l.value)
  from public.activities a where a.id = l.activity_id and l.activity_id = 'sleep_hours';

-- Make sure only signed-in users can call the replaced functions
revoke execute on function public.activity_points(public.activities, numeric) from anon, public;
revoke execute on function public.set_log(date, text, numeric) from anon, public;
grant execute on function public.activity_points(public.activities, numeric) to authenticated;
grant execute on function public.set_log(date, text, numeric) to authenticated;
