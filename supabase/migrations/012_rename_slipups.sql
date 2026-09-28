-- ============================================================================
-- 012: new names (and matching icons) for three slip-ups. Points unchanged.
-- Safe to run more than once.
-- ============================================================================
update public.activities set name = 'Pollution',            icon = 'factory'  where id = 'smoke';
update public.activities set name = 'Preservative drinks',  icon = 'cup-soda' where id = 'alcohol';
update public.activities set name = 'Spoilt green veggies', icon = 'leaf'     where id = 'weed';
