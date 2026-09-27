-- =====================================================================
-- 005: simpler Nutrition, and "Focused study" is now just "Study".
--   * "Hit calorie/diet goal" +10   <- was Hit protein goal (+8)
--   * "3L water"               +5
--   * "Home-cooked meal"       +5   (was +3)
--   * Fruits & veggies and Supplements removed
-- Past days keep their points. Today's/yesterday's entries are updated to
-- the new points, and entries for removed items on those days are dropped.
-- Safe to run more than once.
-- =====================================================================

update public.activities set name = 'Hit calorie/diet goal', hint = 'Stuck to your plan today', icon = 'target', points = 10, sort = 1, active = true
 where id = 'protein';
update public.activities set sort = 2, active = true where id = 'water';
update public.activities set points = 5, sort = 3, active = true where id = 'homecooked';
update public.activities set active = false where id in ('greens', 'supplements');
update public.activities set name = 'Study' where id = 'study_time';

delete from public.logs
 where activity_id in ('greens', 'supplements') and day >= public.app_today() - 1 and not voided;
update public.logs set points = 10 where activity_id = 'protein' and day >= public.app_today() - 1 and not voided;
update public.logs set points = 5 where activity_id = 'homecooked' and day >= public.app_today() - 1 and not voided;
