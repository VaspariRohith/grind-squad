-- =====================================================================
-- 006: Study is one toggle. Study anything for 30+ minutes = +20
-- (the full Study max). No timer.
-- Past days keep their points; today's/yesterday's study entries become
-- the new toggle worth 20. Safe to run more than once.
-- =====================================================================

update public.activities set
  kind = 'check', points = 20, unit = null, step = 1, max_value = null, log_max = null,
  name = 'Study', hint = 'Anything, at least 30 min', icon = 'book'
 where id = 'study_time';

update public.logs set value = 1, points = 20, updated_at = now()
 where activity_id = 'study_time' and day >= public.app_today() - 1 and not voided;
