-- =====================================================================
-- 010: counters instead of switches.
--   * Workout: +5 per 30 min, up to 1h30 (15)
--   * Steps:   +2 per 1,000 steps, up to 10k (20). Replaces "Run or 10k steps"
--   * Study:   first 2 hours +4 each, next 4 hours +3 each, up to 6h (20)
--   * Fitness cap 30 -> 35 so Workout + Steps both count (daily max 105)
--   * "Weed" is now called "Kasuri methi"
-- Past days keep their points. Today's/yesterday's entries are converted
-- to the smallest amount they stood for (people can bump them up).
-- Safe to run more than once.
-- =====================================================================

update public.categories set daily_cap = 35 where id = 'fitness';

update public.activities set kind = 'count', points = 5, unit = 'min', step = 30, max_value = 90, log_max = 240,
  options = null, name = 'Workout', hint = 'Gym or home workout', icon = 'dumbbell', sort = 1, active = true
 where id = 'gym';
update public.activities set kind = 'count', points = 2, unit = 'k', step = 1, max_value = 10, log_max = 50,
  options = null, name = 'Steps', hint = 'Walks and runs both count', icon = 'footprints', sort = 2, active = true
 where id = 'steps';
update public.activities set active = false where id = 'run';
update public.activities set kind = 'band', points = 0, unit = 'min', step = 60, max_value = null, log_max = 960,
  name = 'Study', hint = 'First 2h: +4 each, then +3 each', icon = 'book',
  options = '[{"from":60,"label":"1h","points":4},{"from":120,"label":"2h","points":8},{"from":180,"label":"3h","points":11},{"from":240,"label":"4h","points":14},{"from":300,"label":"5h","points":17},{"from":360,"label":"6h","points":20}]'
 where id = 'study_time';
update public.activities set name = 'Kasuri methi' where id = 'weed';

-- Workout is in minutes now, so the 24-hour check mentions it too
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
    raise exception 'Study, sleep and workout together can''t be more than 24 hours';
  end if;

  insert into logs (user_id, day, activity_id, category_id, value, points, is_negative)
  values (v_uid, p_day, p_activity, a.category_id, p_value, activity_points(a, p_value), v_neg)
  on conflict (user_id, day, activity_id) do update
     set value = excluded.value, points = excluded.points, updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- Today's/yesterday's entries -> new units
update public.logs set value = 30, points = 5, updated_at = now()                 -- "30+ min workout" -> 30 min
 where activity_id = 'gym' and value < 30 and day >= public.app_today() - 1 and not voided;
update public.logs l set activity_id = 'steps', value = 10, points = 20, updated_at = now()   -- "run or 10k steps" -> 10k
 where l.activity_id = 'run' and l.day >= public.app_today() - 1 and not l.voided
   and not exists (select 1 from public.logs s where s.user_id = l.user_id and s.day = l.day and s.activity_id = 'steps');
delete from public.logs where activity_id = 'run' and day >= public.app_today() - 1 and not voided;
update public.logs set value = 60, points = 4, updated_at = now()                  -- "studied 30+ min" -> 1 hour
 where activity_id = 'study_time' and value < 60 and day >= public.app_today() - 1 and not voided;
