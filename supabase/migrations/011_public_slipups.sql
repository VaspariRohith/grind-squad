-- ============================================================================
-- 011: slip-ups are public. Everyone in the squad now sees everyone's
-- slip-up entries (junk, alcohol, smoking, kasuri methi) in the feed,
-- including ones logged before this change. They still can't be reported
-- (a report can only remove an entry, which would only help the person).
-- Safe to run more than once.
-- ============================================================================

drop policy if exists "read logs" on public.logs;
create policy "read logs" on public.logs for select to authenticated using (true);

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
  if l.id is null then raise exception 'Entry not found'; end if;
  if l.is_negative then raise exception 'Slip-ups can''t be reported'; end if;
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
