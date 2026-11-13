-- GC-01 remote DML verification. Intended for the linked development project.
-- All fixtures are synthetic and enclosed in one transaction that is rolled back.
begin;

create temporary table gc01_test_results (
  check_name text primary key,
  result text not null,
  detail text
) on commit drop;

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_couple_a uuid;
  v_couple_b uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_calendar_a text := 'gc01-test-' || gen_random_uuid()::text;
  v_calendar_b text := 'gc01-test-' || gen_random_uuid()::text;
  v_event uuid;
  v_fk_event uuid;
  v_crud_event uuid;
  v_key_version text := 'gc01-test-only';
  v_count integer;
begin
  select id into v_user_a from auth.users order by created_at limit 1;
  select id into v_user_b from auth.users where id <> v_user_a order by created_at limit 1;
  if v_user_a is null or v_user_b is null then
    raise exception 'DML verification requires two existing auth users; no users were modified';
  end if;

  insert into public.couples(relationship_start) values (date '2026-01-01') returning id into v_couple_a;
  insert into public.couples(relationship_start) values (date '2026-01-02') returning id into v_couple_b;

  insert into public.couple_events(couple_id, title, event_date, event_type)
  values (v_couple_a, 'GC-01 synthetic event', date '2026-01-03', 'event')
  returning id into v_event;

  insert into public.google_calendar_connections(couple_id, calendar_id, owner_user_id)
  values (v_couple_a, v_calendar_a, v_user_a) returning id into v_connection_a;
  insert into public.google_calendar_credentials(
    connection_id, couple_id, owner_user_id, google_sub,
    refresh_token_ciphertext, encryption_nonce, encryption_key_version
  ) values (
    v_connection_a, v_couple_a, v_user_a, 'gc01-test-google-sub-a',
    decode('0102030405060708', 'hex'), decode('000000000000000000000000', 'hex'), v_key_version
  );
  update public.google_calendar_connections set status = 'active' where id = v_connection_a;

  insert into public.google_calendar_event_mappings(
    connection_id, couple_id, calendar_id, event_key, event_id, google_event_id, base_snapshot
  ) values (
    v_connection_a, v_couple_a, v_calendar_a, v_event, v_event, 'gc01-google-event-1',
    jsonb_build_object('title', 'GC-01 synthetic event', 'event_date', '2026-01-03')
  );
  insert into gc01_test_results values ('same_couple_event_mapping', 'PASS', 'own-couple event mapping accepted');

  insert into public.couple_events(couple_id, title, event_date, event_type)
  values (v_couple_a, 'GC-01 FK event', date '2026-01-07', 'event') returning id into v_fk_event;
  insert into public.google_calendar_event_mappings(
    connection_id, couple_id, calendar_id, event_key, event_id, google_event_id
  ) values (v_connection_a, v_couple_a, v_calendar_a, v_fk_event, v_fk_event, 'gc01-google-event-fk');
  insert into public.google_calendar_outbox(
    connection_id, couple_id, event_key, event_id, operation_type, source_version, event_snapshot, status
  ) values (
    v_connection_a, v_couple_a, v_fk_event, v_fk_event, 'delete', 1,
    jsonb_build_object('title', 'GC-01 FK event', 'event_date', '2026-01-07'), 'succeeded'
  );
  insert into public.google_calendar_conflicts(connection_id, couple_id, event_key, event_id, conflict_type, state)
  values (v_connection_a, v_couple_a, v_fk_event, v_fk_event, 'both_modified', 'dismissed');
  insert into public.google_calendar_recovery_records(
    connection_id, couple_id, event_key, event_id, calendar_id, deleted_from, event_snapshot
  ) values (
    v_connection_a, v_couple_a, v_fk_event, v_fk_event, v_calendar_a, 'app',
    jsonb_build_object('title', 'GC-01 FK event', 'event_date', '2026-01-07')
  );
  delete from public.couple_events where id = v_fk_event;
  select count(*) into v_count from public.google_calendar_event_mappings
    where event_key = v_fk_event and event_id is null;
  if v_count <> 1 then raise exception 'Mapping FK did not retain key and null event_id after event deletion'; end if;
  select count(*) into v_count from public.google_calendar_outbox
    where event_key = v_fk_event and event_id is null;
  if v_count <> 1 then raise exception 'Outbox FK did not retain key and null event_id after event deletion'; end if;
  select count(*) into v_count from public.google_calendar_conflicts
    where event_key = v_fk_event and event_id is null;
  if v_count <> 1 then raise exception 'Conflict FK did not retain key and null event_id after event deletion'; end if;
  select count(*) into v_count from public.google_calendar_recovery_records
    where event_key = v_fk_event and event_id = v_fk_event;
  if v_count <> 1 then raise exception 'Recovery did not retain its historical event_id'; end if;
  insert into gc01_test_results values ('event_delete_fk_recovery', 'PASS', 'live references detached; recovery snapshot retained historical event id');

  begin
    insert into public.google_calendar_event_mappings(
      connection_id, couple_id, calendar_id, event_key, event_id, google_event_id
    ) values (v_connection_a, v_couple_a, v_calendar_a, v_event, v_event, 'gc01-google-event-2');
    raise exception 'Expected duplicate event mapping to be rejected';
  exception when unique_violation then
    insert into gc01_test_results values ('duplicate_event_mapping', 'PASS', 'unique constraint rejected duplicate');
  end;

  insert into public.couple_events(couple_id, title, event_date, event_type)
  values (v_couple_b, 'GC-01 foreign synthetic event', date '2026-01-04', 'event');
  select id into v_crud_event from public.couple_events where couple_id = v_couple_b and title = 'GC-01 foreign synthetic event';
  begin
    insert into public.google_calendar_event_mappings(
      connection_id, couple_id, calendar_id, event_key, event_id, google_event_id
    ) values (v_connection_a, v_couple_a, v_calendar_a, v_crud_event, v_crud_event, 'gc01-google-event-foreign');
    raise exception 'Expected cross-couple event mapping to be rejected';
  exception when foreign_key_violation or check_violation then
    insert into gc01_test_results values ('cross_couple_event_mapping', 'PASS', 'mapping to another couple event rejected');
  end;
  insert into gc01_test_results values ('event_couple_ownership', 'PASS', 'ownership trigger rejects cross-couple event references');

  begin
    update public.couple_events set couple_id = v_couple_b where id = v_event;
    raise exception 'Expected linked event couple reassignment to be rejected';
  exception when check_violation then
    insert into gc01_test_results values ('linked_event_couple_change', 'PASS', 'linked event reassignment rejected');
  end;

  insert into public.google_calendar_outbox(
    connection_id, couple_id, event_key, event_id, operation_type, source_version, event_snapshot
  ) values (
    v_connection_a, v_couple_a, v_event, v_event, 'upsert', 1,
    jsonb_build_object('title', 'GC-01 synthetic event', 'event_date', '2026-01-03')
  );
  begin
    insert into public.google_calendar_outbox(
      connection_id, couple_id, event_key, event_id, operation_type, source_version, event_snapshot
    ) values (
      v_connection_a, v_couple_a, v_event, v_event, 'upsert', 1,
      jsonb_build_object('title', 'GC-01 synthetic event', 'event_date', '2026-01-03')
    );
    raise exception 'Expected duplicate outbox operation to be rejected';
  exception when unique_violation then
    insert into gc01_test_results values ('outbox_idempotency', 'PASS', 'idempotency unique constraint rejected duplicate');
  end;
  begin
    insert into public.google_calendar_outbox(
      connection_id, couple_id, event_key, event_id, operation_type, source_version, event_snapshot
    ) values (v_connection_a, v_couple_a, gen_random_uuid(), null, 'upsert', 1, '{"description":"unsafe"}'::jsonb);
    raise exception 'Expected unsafe outbox snapshot to be rejected';
  exception when check_violation then
    insert into gc01_test_results values ('outbox_snapshot_validation', 'PASS', 'unsafe snapshot rejected');
  end;
  begin
    insert into public.google_calendar_outbox(
      connection_id, couple_id, event_key, operation_type, source_version, event_snapshot
    ) values (v_connection_a, v_couple_a, gen_random_uuid(), 'upsert', 1, null);
    raise exception 'Expected missing outbox snapshot to be rejected';
  exception when not_null_violation then
    insert into gc01_test_results values ('outbox_snapshot_required', 'PASS', 'required event snapshot enforced');
  end;

  insert into public.google_calendar_conflicts(connection_id, couple_id, event_key, event_id, conflict_type)
  values (v_connection_a, v_couple_a, v_event, v_event, 'both_modified');
  begin
    insert into public.google_calendar_conflicts(connection_id, couple_id, event_key, event_id, conflict_type)
    values (v_connection_a, v_couple_a, v_event, v_event, 'both_modified');
    raise exception 'Expected duplicate open conflict to be rejected';
  exception when unique_violation then
    insert into gc01_test_results values ('open_conflict_uniqueness', 'PASS', 'partial unique index rejected duplicate');
  end;

  update public.google_calendar_connections set owner_user_id = v_user_b where id = v_connection_a;
  select count(*) into v_count from public.google_calendar_connections
    where id = v_connection_a and status = 'reauth_required' and authorization_epoch = 2;
  if v_count <> 1 then raise exception 'Owner A to B transition did not fence connection'; end if;
  select count(*) into v_count from public.google_calendar_credentials
    where connection_id = v_connection_a and owner_user_id = v_user_a and credential_status = 'revocation_pending'
      and refresh_token_ciphertext is not null;
  if v_count <> 1 then raise exception 'Owner A to B transition did not preserve old credential for revocation'; end if;
  insert into gc01_test_results values ('owner_a_to_b_transition', 'PASS', 'connection fenced and old credential marked revocation_pending');

  update public.google_calendar_credentials
    set credential_status = 'revoked', refresh_token_ciphertext = null, encryption_nonce = null,
        encryption_key_version = null
    where connection_id = v_connection_a;
  select count(*) into v_count from public.google_calendar_credentials
    where connection_id = v_connection_a and credential_status = 'revoked'
      and refresh_token_ciphertext is null and encryption_nonce is null;
  if v_count <> 1 then raise exception 'revocation_pending to revoked finalization failed'; end if;
  insert into gc01_test_results values ('revocation_finalize', 'PASS', 'revoked state atomically scrubbed token material');

  insert into public.google_calendar_connections(couple_id, calendar_id, owner_user_id)
  values (v_couple_b, v_calendar_b, v_user_a) returning id into v_connection_b;
  insert into public.google_calendar_credentials(
    connection_id, couple_id, owner_user_id, google_sub,
    refresh_token_ciphertext, encryption_nonce, encryption_key_version
  ) values (
    v_connection_b, v_couple_b, v_user_a, 'gc01-test-google-sub-b',
    decode('1112131415161718', 'hex'), decode('111111111111111111111111', 'hex'), v_key_version
  );
  update public.google_calendar_connections set status = 'active' where id = v_connection_b;
  update public.google_calendar_connections set owner_user_id = null where id = v_connection_b;
  select count(*) into v_count from public.google_calendar_connections
    where id = v_connection_b and owner_user_id is null and status = 'reauth_required' and authorization_epoch = 2;
  if v_count <> 1 then raise exception 'Owner removal did not fence connection'; end if;
  insert into gc01_test_results values ('owner_to_null_transition', 'PASS', 'removing owner fenced connection');

  insert into public.google_calendar_recovery_records(
    connection_id, couple_id, event_key, event_id, calendar_id, deleted_from, event_snapshot
  ) values (
    v_connection_b, v_couple_b, gen_random_uuid(), null, v_calendar_b, 'app',
    jsonb_build_object('title', 'GC-01 recovery fixture', 'event_date', '2026-01-05')
  );
  update public.google_calendar_credentials
    set credential_status = 'revoked', refresh_token_ciphertext = null, encryption_nonce = null,
        encryption_key_version = null
    where connection_id = v_connection_b;
  update public.google_calendar_connections set status = 'revoked' where id = v_connection_b;
  delete from public.google_calendar_connections where id = v_connection_b;
  select count(*) into v_count from public.google_calendar_recovery_records
    where connection_id = v_connection_b and couple_id = v_couple_b;
  if v_count <> 1 then raise exception 'Recovery row did not survive connection hard delete'; end if;
  insert into gc01_test_results values ('recovery_after_connection_delete', 'PASS', 'recovery row survived connection cascade');

  insert into public.couple_events(couple_id, title, event_date, event_type)
  values (v_couple_a, 'GC-01 CRUD regression', date '2026-01-06', 'event') returning id into v_crud_event;
  update public.couple_events set title = 'GC-01 CRUD regression updated' where id = v_crud_event;
  select count(*) into v_count from public.couple_events where id = v_crud_event and title = 'GC-01 CRUD regression updated' and version = 2;
  if v_count <> 1 then raise exception 'couple_events update regression failed'; end if;
  delete from public.couple_events where id = v_crud_event;
  if exists (select 1 from public.couple_events where id = v_crud_event) then raise exception 'couple_events delete regression failed'; end if;
  insert into gc01_test_results values ('couple_events_crud', 'PASS', 'synthetic event insert/update/delete succeeded');

  insert into public.google_calendar_sync_state(connection_id, couple_id, state, watch_channel_id, watch_resource_id, watch_expires_at)
  values (v_connection_a, v_couple_a, 'idle', 'gc01-watch-' || gen_random_uuid()::text, 'gc01-resource', now() + interval '1 day');
  insert into gc01_test_results values ('sync_watch_state', 'PASS', 'valid watch metadata accepted');
end;
$$;

select check_name, result, detail from gc01_test_results order by check_name;
rollback;
