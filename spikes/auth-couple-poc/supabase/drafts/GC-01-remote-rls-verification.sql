-- GC-01 remote verification: run only against the approved development/test project.
-- Creates temporary couple/connection fixtures in one transaction and rolls all
-- rows back. It never reads or prints existing event or health-record contents.
begin;

create temp table gc01_ids(couple_one uuid, user_one uuid, couple_two uuid);
grant select on pg_temp.gc01_ids to authenticated;

do $$
declare
  v_couple_one uuid;
  v_user_one uuid;
  v_couple_two uuid;
begin
  select couple_id, user_id into v_couple_one, v_user_one
  from public.couple_members
  limit 1;
  if v_couple_one is null then
    raise exception 'A test couple member is required';
  end if;

  insert into public.couples(relationship_start)
  values (date '2026-01-01')
  returning id into v_couple_two;

  insert into public.google_calendar_connections
    (couple_id, calendar_id, owner_user_id, status)
  values
    (v_couple_one, 'gc01-rls-check-one', v_user_one, 'authorizing'),
    (v_couple_two, 'gc01-rls-check-two', v_user_one, 'authorizing');

  insert into pg_temp.gc01_ids values
    (v_couple_one, v_user_one, v_couple_two);
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select user_one::text from pg_temp.gc01_ids),
  true
);
set local role authenticated;

select
  (select count(*) = 1 from public.google_calendar_connections c, pg_temp.gc01_ids i
    where c.couple_id = i.couple_one) as member_connection_visible,
  (select count(*) = 0 from public.google_calendar_connections c, pg_temp.gc01_ids i
    where c.couple_id = i.couple_two) as other_couple_hidden,
  not has_table_privilege('authenticated', 'public.google_calendar_credentials', 'select')
    as credentials_denied,
  not has_table_privilege('authenticated', 'public.google_calendar_event_mappings', 'select')
    and not has_table_privilege('authenticated', 'public.google_calendar_outbox', 'select')
    and not has_table_privilege('authenticated', 'public.google_calendar_sync_state', 'select')
    as server_tables_denied,
  has_column_privilege('authenticated', 'public.google_calendar_conflicts', 'id', 'select')
    and not has_column_privilege('authenticated', 'public.google_calendar_conflicts', 'app_snapshot', 'select')
    as conflict_snapshot_hidden,
  has_column_privilege('authenticated', 'public.google_calendar_recovery_records', 'id', 'select')
    and not has_column_privilege('authenticated', 'public.google_calendar_recovery_records', 'event_snapshot', 'select')
    as recovery_snapshot_hidden,
  not has_table_privilege('anon', 'public.google_calendar_credentials', 'select')
    as anon_denied
from pg_temp.gc01_ids;

rollback;
