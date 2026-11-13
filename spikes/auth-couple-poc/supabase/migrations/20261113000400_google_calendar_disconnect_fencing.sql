-- GC-02: serialize disconnect/revocation against OAuth completion and refresh.
begin;

create function public.gc02_begin_google_disconnect(
  p_couple_id uuid,
  p_user_id uuid
)
returns table (
  connection_id uuid,
  couple_id uuid,
  connection_owner_user_id uuid,
  authorization_epoch bigint,
  connection_status text,
  credential_owner_user_id uuid,
  google_sub text,
  refresh_token_ciphertext bytea,
  encryption_nonce bytea,
  encryption_key_version text,
  credential_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_calendar_connections%rowtype;
  v_credential public.google_calendar_credentials%rowtype;
  v_pending boolean;
  v_has_credential boolean;
begin
  if not exists (
    select 1 from public.couple_members m
    where m.couple_id = p_couple_id and m.user_id = p_user_id
  ) then
    raise exception 'Couple membership required' using errcode = '42501';
  end if;

  select * into v_connection
  from public.google_calendar_connections c
  where c.couple_id = p_couple_id and c.status not in ('disconnected', 'revoked')
  order by c.created_at desc
  limit 1
  for update;
  if not found then return; end if;

  select * into v_credential
  from public.google_calendar_credentials cr
  where cr.connection_id = v_connection.id
  for update;
  v_has_credential := found;
  v_pending := v_connection.status = 'revocation_pending'
    or (v_has_credential and v_credential.credential_status = 'revocation_pending');
  if v_connection.owner_user_id is distinct from p_user_id and not v_pending then
    raise exception 'Only the authorized connection owner can disconnect'
      using errcode = '42501';
  end if;

  delete from public.google_calendar_oauth_sessions s where s.connection_id = v_connection.id;
  if v_has_credential then
    if v_credential.refresh_token_ciphertext is not null and v_credential.credential_status <> 'revoked' then
      update public.google_calendar_credentials
      set credential_status = 'revocation_pending', token_updated_at = now()
      where connection_id = v_connection.id;
    end if;
  end if;
  update public.google_calendar_connections c
  set status = 'revocation_pending', last_error_code = null, updated_at = now()
  where c.id = v_connection.id;

  return query
    select c.id, c.couple_id, c.owner_user_id, c.authorization_epoch, c.status,
           cr.owner_user_id, cr.google_sub, cr.refresh_token_ciphertext,
           cr.encryption_nonce, cr.encryption_key_version, cr.credential_status
    from public.google_calendar_connections c
    left join public.google_calendar_credentials cr on cr.connection_id = c.id
    where c.id = v_connection.id;
end;
$$;

create function public.gc02_mark_google_reauth_required(
  p_connection_id uuid,
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_authorization_epoch bigint,
  p_expected_token_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_calendar_connections%rowtype;
  v_credential public.google_calendar_credentials%rowtype;
begin
  select * into v_connection
  from public.google_calendar_connections c
  where c.id = p_connection_id and c.couple_id = p_couple_id
  for update;
  if not found or v_connection.status <> 'active'
     or v_connection.owner_user_id is distinct from p_owner_user_id
     or v_connection.authorization_epoch is distinct from p_authorization_epoch then
    raise exception 'Google connection is no longer active'
      using errcode = '55000';
  end if;
  select * into v_credential
  from public.google_calendar_credentials cr
  where cr.connection_id = p_connection_id and cr.couple_id = p_couple_id
  for update;
  if not found or v_credential.credential_status <> 'active'
     or v_credential.token_updated_at is distinct from p_expected_token_updated_at then
    raise exception 'Google credential changed during refresh'
      using errcode = '40001';
  end if;

  update public.google_calendar_credentials
  set credential_status = 'reauth_required'
  where connection_id = p_connection_id;
  update public.google_calendar_connections
  set status = 'reauth_required', last_error_code = 'google_refresh_rejected', updated_at = now()
  where id = p_connection_id;
  return true;
end;
$$;

revoke all on function public.gc02_begin_google_disconnect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.gc02_begin_google_disconnect(uuid, uuid) to service_role;
revoke all on function public.gc02_mark_google_reauth_required(uuid, uuid, uuid, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.gc02_mark_google_reauth_required(uuid, uuid, uuid, bigint, timestamptz)
  to service_role;

comment on function public.gc02_begin_google_disconnect(uuid, uuid)
  is 'Fences OAuth completion/refresh and returns the server-only credential for revocation.';
comment on function public.gc02_mark_google_reauth_required(uuid, uuid, uuid, bigint, timestamptz)
  is 'Atomically fences a revoked Google refresh token unless the connection or credential changed.';

commit;
