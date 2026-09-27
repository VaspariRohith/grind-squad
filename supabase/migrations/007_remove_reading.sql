-- =====================================================================
-- 007: remove "Read 20 min" (Study is one +20 toggle now, so reading
-- could no longer add anything). Past days keep their points; today's and
-- yesterday's reading entries are dropped. Safe to run more than once.
-- =====================================================================
update public.activities set active = false where id = 'reading';
delete from public.logs where activity_id = 'reading' and day >= public.app_today() - 1 and not voided;
