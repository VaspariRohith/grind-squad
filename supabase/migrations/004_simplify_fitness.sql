-- =====================================================================
-- 004: simpler Fitness.
--   * "Workout" (gym or home) +15   <- was Gym session / Home workout
--   * "Run or 10k steps"      +15   <- was Run / 10k steps
--   * Stretch / yoga removed
-- Past days keep the points they were logged with. For today and
-- yesterday (the days people can still edit), old entries are folded
-- into the new items so the screen matches the score.
-- Safe to run more than once.
-- =====================================================================

update public.activities set name = 'Workout', hint = 'Gym or home, 30+ min', icon = 'dumbbell', points = 15, sort = 1, active = true
 where id = 'gym';
update public.activities set name = 'Run or 10k steps', hint = 'A 2+ km run or 10,000 steps', icon = 'footprints', points = 15, sort = 2, active = true
 where id = 'run';
update public.activities set active = false where id in ('workout', 'steps', 'stretch');

-- Fold today's/yesterday's entries into the new items
-- (home workout -> Workout, steps -> Run or 10k steps), unless already logged there
update public.logs l set activity_id = 'gym', points = 15, updated_at = now()
 where l.activity_id = 'workout' and l.day >= public.app_today() - 1 and not l.voided
   and not exists (select 1 from public.logs g where g.user_id = l.user_id and g.day = l.day and g.activity_id = 'gym');
update public.logs l set activity_id = 'run', points = 15, updated_at = now()
 where l.activity_id = 'steps' and l.day >= public.app_today() - 1 and not l.voided
   and not exists (select 1 from public.logs g where g.user_id = l.user_id and g.day = l.day and g.activity_id = 'run');
-- Whatever is left of the removed items on those two days is dropped
delete from public.logs
 where activity_id in ('workout', 'steps', 'stretch') and day >= public.app_today() - 1 and not voided;

-- Entries already logged today/yesterday as gym/run get the new points
update public.logs set points = 15
 where activity_id in ('gym', 'run') and day >= public.app_today() - 1 and not voided;
