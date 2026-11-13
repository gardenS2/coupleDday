-- GC-02 schema and server-only RPC verification; all fixture DML is rolled back.
begin;

create temporary table gc02_test_results (
  check_name text primary key,
  result text not null,
  detail text
) on commit drop;

do $$
declare
  v_user uuid;
  v_couple uuid;
  v_connection uuid;
  v_session uuid;
  v_disconnect record;
  v_token_updated_at timestamptz;
  v_count integer;
  v_status text;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'GC-02 DB tests require one existing auth user'; end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='google_calendar_oauth_sessions' and c.relrowsecurity
  ) then raise exception 'OAuth session RLS is not enabled'; end if;
  if has_table_privilege('anon','public.google_calendar_oauth_sessions','SELECT')
     or has_table_privilege('authenticated','public.google_calendar_oauth_sessions','SELECT')
     or has_table_privilege('authenticated','public.google_calendar_oauth_sessions','INSERT')
     or not has_table_privilege('service_role','public.google_calendar_oauth_sessions','INSERT') then
    raise exception 'OAuth session table grants are not server-only';
  end if;
  if has_function_privilege('anon','public.gc02_store_google_credential(uuid,uuid,uuid,bigint,text,bytea,bytea,text,text[])','EXECUTE')
     or has_function_privilege('authenticated','public.gc02_store_google_credential(uuid,uuid,uuid,bigint,text,bytea,bytea,text,text[])','EXECUTE')
     or not has_function_privilege('service_role','public.gc02_store_google_credential(uuid,uuid,uuid,bigint,text,bytea,bytea,text,text[])','EXECUTE') then
    raise exception 'Credential storage RPC grants are not server-only';
  end if;
  if has_function_privilege('anon','public.gc02_record_google_token_refresh(uuid,uuid,uuid,bigint,timestamp with time zone,bytea,bytea,text)','EXECUTE')
     or has_function_privilege('authenticated','public.gc02_record_google_token_refresh(uuid,uuid,uuid,bigint,timestamp with time zone,bytea,bytea,text)','EXECUTE')
     or not has_function_privilege('service_role','public.gc02_record_google_token_refresh(uuid,uuid,uuid,bigint,timestamp with time zone,bytea,bytea,text)','EXECUTE') then
    raise exception 'Token refresh RPC grants are not server-only';
  end if;
  if has_function_privilege('authenticated','public.gc02_begin_google_disconnect(uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.gc02_begin_google_disconnect(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.gc02_mark_google_reauth_required(uuid,uuid,uuid,bigint,timestamp with time zone)','EXECUTE')
     or not has_function_privilege('service_role','public.gc02_mark_google_reauth_required(uuid,uuid,uuid,bigint,timestamp with time zone)','EXECUTE') then
    raise exception 'Disconnect/reauth RPC grants are not server-only';
  end if;
  insert into gc02_test_results values ('oauth_session_and_rpc_grants', 'PASS', 'RLS enabled; anon/authenticated denied; service_role allowed');

  select m.user_id,m.couple_id into v_user,v_couple
  from public.couple_members m
  where not exists (
    select 1 from public.google_calendar_connections c
    where c.couple_id=m.couple_id and c.status not in ('disconnected','revoked')
  )
  order by m.joined_at limit 1;
  if v_user is null or v_couple is null then
    raise exception 'GC-02 DB test requires an existing couple without a live Google connection';
  end if;
  insert into public.google_calendar_connections(couple_id,owner_user_id,status)
  values (v_couple,v_user,'authorizing') returning id into v_connection;

  v_status := public.gc02_store_google_credential(
    v_connection,v_couple,v_user,1,'gc02-test-sub',
    decode('0102030405060708','hex'),decode('000000000000000000000000','hex'),
    'gc02-test-key',array['openid','email','profile','https://www.googleapis.com/auth/calendar.events']
  );
  if v_status <> 'authorizing' then raise exception 'Initial OAuth credential should await calendar selection'; end if;
  select count(*) into v_count from public.google_calendar_credentials
    where connection_id=v_connection and credential_status='active'
      and refresh_token_ciphertext=decode('0102030405060708','hex');
  if v_count <> 1 then raise exception 'Credential RPC did not atomically save encrypted material'; end if;
  insert into gc02_test_results values ('credential_store_atomic', 'PASS', 'credential saved; connection remains non-syncing until calendar selected');

  update public.google_calendar_connections set calendar_id='gc02-test-calendar', status='active' where id=v_connection;
  select token_updated_at into v_token_updated_at from public.google_calendar_credentials where connection_id=v_connection;
  if not public.gc02_record_google_token_refresh(
    v_connection,v_couple,v_user,1,v_token_updated_at,
    decode('1112131415161718','hex'),decode('111111111111111111111111','hex'),'gc02-test-key'
  ) then raise exception 'Token rotation compare-and-set failed'; end if;
  select count(*) into v_count from public.google_calendar_credentials
    where connection_id=v_connection and refresh_token_ciphertext=decode('1112131415161718','hex')
      and encryption_nonce=decode('111111111111111111111111','hex');
  if v_count <> 1 then raise exception 'Rotated encrypted token was not recorded'; end if;
  insert into gc02_test_results values ('refresh_rotation_cas', 'PASS', 'active epoch and prior token timestamp accepted for rotation');

  begin
    perform public.gc02_record_google_token_refresh(
      v_connection,v_couple,v_user,999,v_token_updated_at,null,null,null
    );
    raise exception 'Expected stale authorization epoch to be rejected';
  exception when sqlstate '55000' or sqlstate '40001' then
    insert into gc02_test_results values ('refresh_fencing', 'PASS', 'stale authorization epoch rejected');
  end;

  insert into public.google_calendar_oauth_sessions(
    connection_id,couple_id,user_id,authorization_epoch,state_hash,code_verifier,
    previous_connection_status,expires_at
  ) values (
    v_connection,v_couple,v_user,1,decode(repeat('ab',32),'hex'),repeat('c',43),
    'active',now()+interval '5 minutes'
  ) returning id into v_session;
  delete from public.google_calendar_oauth_sessions where id=v_session returning id into v_session;
  if v_session is null then raise exception 'Single-use state did not return consumed row'; end if;
  delete from public.google_calendar_oauth_sessions where id=v_session returning id into v_session;
  if v_session is not null then raise exception 'OAuth state could be consumed twice'; end if;
  insert into gc02_test_results values ('oauth_state_single_use', 'PASS', 'one-time server-side OAuth state consumed once');

  select token_updated_at into v_token_updated_at from public.google_calendar_credentials where connection_id=v_connection;
  if not public.gc02_mark_google_reauth_required(v_connection,v_couple,v_user,1,v_token_updated_at) then
    raise exception 'Atomic reauth state transition failed';
  end if;
  select count(*) into v_count from public.google_calendar_connections c
    join public.google_calendar_credentials cr on cr.connection_id=c.id
    where c.id=v_connection and c.status='reauth_required' and cr.credential_status='reauth_required';
  if v_count <> 1 then raise exception 'Reauth transition did not fence both connection and credential'; end if;
  insert into gc02_test_results values ('reauth_required_transition', 'PASS', 'invalid-grant handling fences the connection and credential atomically');

  select * into v_disconnect from public.gc02_begin_google_disconnect(v_couple,v_user);
  if not found or v_disconnect.connection_id <> v_connection
     or v_disconnect.connection_status <> 'revocation_pending'
     or v_disconnect.credential_status <> 'revocation_pending'
     or v_disconnect.refresh_token_ciphertext is null then
    raise exception 'Atomic disconnect did not fence and return credential for server revocation';
  end if;
  insert into gc02_test_results values ('disconnect_fencing', 'PASS', 'disconnect locks connection, cancels OAuth state and retains token pending revoke');

  begin
    perform public.gc02_store_google_credential(
      v_connection,v_couple,v_user,1,'gc02-test-sub',
      decode('0102030405060708','hex'),decode('000000000000000000000000','hex'),
      'gc02-test-key',array['openid']
    );
    raise exception 'Expected callback credential write to be blocked after disconnect';
  exception when sqlstate '55000' then
    insert into gc02_test_results values ('disconnect_blocks_oauth_callback', 'PASS', 'OAuth completion cannot reactivate a disconnecting connection');
  end;
  begin
    perform public.gc02_record_google_token_refresh(
      v_connection,v_couple,v_user,1,v_token_updated_at,null,null,null
    );
    raise exception 'Expected token refresh to be blocked after disconnect';
  exception when sqlstate '55000' then
    insert into gc02_test_results values ('disconnect_blocks_refresh', 'PASS', 'token refresh cannot reactivate or overwrite a disconnecting connection');
  end;
end;
$$;

select check_name,result,detail from gc02_test_results order by check_name;
rollback;
