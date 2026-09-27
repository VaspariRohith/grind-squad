-- =====================================================================
-- 008: Weed is now -20 (was -10). The Slip-ups max penalty goes from 40 to
-- 55 (= junk 15 + alcohol 10 + smoking 10 + weed 20) so every slip-up
-- always counts in full. Today's/yesterday's weed entries are re-scored;
-- older days keep their points. Safe to run more than once.
-- =====================================================================
update public.activities set points = 20 where id = 'weed';
update public.categories set daily_cap = 55 where id = 'vices';
update public.logs set points = -20 where activity_id = 'weed' and day >= public.app_today() - 1 and not voided;
