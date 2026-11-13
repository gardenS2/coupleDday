-- GC-02: short-lived, server-only state for Google Calendar authorization.
-- The callback consumes one row atomically; no OAuth tokens enter this table.
begin;

create table public.google_calendar_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  couple_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  authorization_epoch bigint not null check (authorization_epoch > 0),
  state_hash bytea not null unique check (octet_length(state_hash) = 32),
  code_verifier text not null check (char_length(code_verifier) between 43 and 128),
  previous_connection_status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint google_calendar_oauth_sessions_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_oauth_sessions_expiry_ck
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint google_calendar_oauth_sessions_connection_uq unique (connection_id)
);

create index google_calendar_oauth_sessions_expiry_idx
  on public.google_calendar_oauth_sessions(expires_at);

alter table public.google_calendar_oauth_sessions enable row level security;
revoke all on public.google_calendar_oauth_sessions from public, anon, authenticated;
grant all on public.google_calendar_oauth_sessions to service_role;

create function public.gc02_store_google_credential(
  p_connection_id uuid,
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_authorization_epoch bigint,
  p_google_sub text,
  p_refresh_token_ciphertext bytea,
  p_encryption_nonce bytea,
  p_encryption_key_version text,
  p_granted_scopes text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.google_calendar_connections%rowtype;
  v_previous public.google_calendar_credentials%rowtype;
  v_status text;
begin
  select * into v_connection
  from public.google_calendar_connections
  where id = p_connection_id and couple_id = p_couple_id
  for update;
  if not found or v_connection.owner_user_id is distinct from p_owner_user_id
     or v_connection.authorization_epoch is distinct from p_authorization_epoch
     or v_connection.status in ('disconnected', 'revoked', 'revocation_pending') then
    raise exception 'Google authorization session is stale'
      using errcode = '55000';
  end if;

  select * into v_previous
  from public.google_calendar_credentials
  where connection_id = p_connection_id
  for update;
  if found and v_previous.credential_status <> 'revoked'
     and v_previous.google_sub is distinct from p_google_sub then
    raise exception 'Google account change requires prior token revocation'
      using errcode = '23514';
  end if;

  insert into public.google_calendar_credentials(
    connection_id, couple_id, owner_user_id, google_sub,
    refresh_token_ciphertext, encryption_nonce, encryption_key_version,
    granted_scopes, credential_status, token_updated_at
  ) values (
    p_connection_id, p_couple_id, p_owner_user_id, p_google_sub,
    p_refresh_token_ciphertext, p_encryption_nonce, p_encryption_key_version,
    p_granted_scopes, 'active', now()
  )
  on conflict (connection_id) do update set
    owner_user_id = excluded.owner_user_id,
    google_sub = excluded.google_sub,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    encryption_nonce = excluded.encryption_nonce,
    encryption_key_version = excluded.encryption_key_version,
    granted_scopes = excluded.granted_scopes,
    credential_status = 'active',
    token_updated_at = now();

  v_status := case when v_connection.calendar_id is null then 'authorizing' else 'active' end;
  update public.google_calendar_connections
  set status = v_status,
      last_verified_at = now(),
      last_error_code = null,
      granted_scopes = p_granted_scopes,
      updated_at = now()
  where id = p_connection_id;
  return v_status;
end;
$$;

revoke all on function public.gc02_store_google_credential(
  uuid, uuid, uuid, bigint, text, bytea, bytea, text, text[]
) from public, anon, authenticated;
grant execute on function public.gc02_store_google_credential(
  uuid, uuid, uuid, bigint, text, bytea, bytea, text, text[]
) to service_role;

create function public.gc02_record_google_token_refresh(
  p_connection_id uuid,
  p_couple_id uuid,
  p_owner_user_id uuid,
  p_authorization_epoch bigint,
  p_expected_token_updated_at timestamptz,
  p_rotated_refresh_token_ciphertext bytea default null,
  p_rotated_encryption_nonce bytea default null,
  p_rotated_encryption_key_version text default null
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
  from public.google_calendar_connections
  where id = p_connection_id and couple_id = p_couple_id
  for update;
  if not found or v_connection.owner_user_id is distinct from p_owner_user_id
     or v_connection.authorization_epoch is distinct from p_authorization_epoch
     or v_connection.status <> 'active' then
    raise exception 'Google connection is no longer active'
      using errcode = '55000';
  end if;

  select * into v_credential
  from public.google_calendar_credentials
  where connection_id = p_connection_id and couple_id = p_couple_id
  for update;
  if not found or v_credential.owner_user_id is distinct from p_owner_user_id
     or v_credential.credential_status <> 'active'
     or v_credential.token_updated_at is distinct from p_expected_token_updated_at then
    raise exception 'Google credential changed during refresh'
      using errcode = '40001';
  end if;
  if (p_rotated_refresh_token_ciphertext is null) <> (p_rotated_encryption_nonce is null)
     or (p_rotated_refresh_token_ciphertext is not null and p_rotated_encryption_key_version is null) then
    raise exception 'Rotated token encryption fields are incomplete'
      using errcode = '22023';
  end if;

  update public.google_calendar_credentials
  set refresh_token_ciphertext = coalesce(p_rotated_refresh_token_ciphertext, refresh_token_ciphertext),
      encryption_nonce = coalesce(p_rotated_encryption_nonce, encryption_nonce),
      encryption_key_version = coalesce(p_rotated_encryption_key_version, encryption_key_version),
      token_updated_at = case when p_rotated_refresh_token_ciphertext is null then token_updated_at else now() end,
      last_refreshed_at = now()
  where connection_id = p_connection_id;
  return true;
end;
$$;

revoke all on function public.gc02_record_google_token_refresh(
  uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, text
) from public, anon, authenticated;
grant execute on function public.gc02_record_google_token_refresh(
  uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, text
) to service_role;

comment on table public.google_calendar_oauth_sessions is
  'GC-02 short-lived server-only OAuth state and PKCE verifier; never client-readable.';
comment on column public.google_calendar_oauth_sessions.code_verifier is
  'Temporary PKCE verifier retained only until the single-use callback is consumed.';
comment on function public.gc02_store_google_credential(
  uuid, uuid, uuid, bigint, text, bytea, bytea, text, text[]
) is 'Atomically stores a server-encrypted Google refresh token and advances the authorized connection state.';
comment on function public.gc02_record_google_token_refresh(
  uuid, uuid, uuid, bigint, timestamptz, bytea, bytea, text
) is 'Compare-and-set persistence for refresh-token rotation; fails if the connection is fenced or credentials changed.';

commit;
