-- GC-01: shared Google Calendar connection, credentials, event mapping, sync state,
-- idempotent outbox, conflict snapshots, and recovery records.
-- Additive only; existing user/health/event data remain intact.
-- Supabase migration runner owns the transaction boundary.

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  calendar_id text,
  calendar_summary text,
  calendar_timezone text,
  owner_user_id uuid references auth.users(id) on delete set null,
  granted_scopes text[] not null default '{}',
  status text not null default 'authorizing'
    check (status in (
      'authorizing', 'active', 'paused', 'reauth_required',
      'permission_lost', 'error', 'recovery_review', 'disconnected',
      'revocation_pending', 'revoked'
    )),
  authorization_epoch bigint not null default 1 check (authorization_epoch > 0),
  partner_access_verified_at timestamptz,
  last_verified_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_id_couple_uq unique (id, couple_id),
  constraint google_calendar_connections_id_couple_calendar_uq
    unique (id, couple_id, calendar_id),
  constraint google_calendar_connections_active_fields_ck check (
    status <> 'active' or (calendar_id is not null and owner_user_id is not null)
  )
);

-- Disconnected/revoked rows retain history; each couple has at most one live pipeline.
create unique index google_calendar_one_live_connection_per_couple_uq
  on public.google_calendar_connections(couple_id)
  where status not in ('disconnected', 'revoked');

create table public.google_calendar_credentials (
  connection_id uuid primary key,
  couple_id uuid not null,
  -- Kept as a server-only historical principal ID for provider-token revoke
  -- retries even after the Supabase Auth account itself has been deleted.
  owner_user_id uuid,
  google_sub text not null,
  refresh_token_ciphertext bytea,
  encryption_nonce bytea,
  encryption_key_version text,
  granted_scopes text[] not null default '{}',
  credential_status text not null default 'active'
    check (credential_status in ('active', 'reauth_required', 'revocation_pending', 'revoked')),
  last_refreshed_at timestamptz,
  token_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint google_calendar_credentials_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_credentials_connection_google_sub_uq
    unique (connection_id, google_sub),
  constraint google_calendar_credentials_nonce_ck
    check (encryption_nonce is null or octet_length(encryption_nonce) = 12),
  constraint google_calendar_credentials_active_material_ck check (
    credential_status <> 'active'
    or (owner_user_id is not null and refresh_token_ciphertext is not null
        and encryption_nonce is not null and encryption_key_version is not null)
  ),
  constraint google_calendar_credentials_pending_material_ck check (
    credential_status <> 'revocation_pending'
    or (refresh_token_ciphertext is not null and encryption_nonce is not null
        and encryption_key_version is not null)
  ),
  constraint google_calendar_credentials_revoked_scrubbed_ck check (
    credential_status <> 'revoked'
    or (refresh_token_ciphertext is null and encryption_nonce is null)
  )
);

create table public.google_calendar_event_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  couple_id uuid not null,
  calendar_id text not null,
  event_key uuid not null,
  event_id uuid references public.couple_events(id) on delete set null,
  google_event_id text not null,
  google_etag text,
  google_updated_at timestamptz,
  last_synced_local_version integer,
  last_synced_google_updated_at timestamptz,
  last_synced_hash text,
  base_snapshot jsonb,
  mapping_status text not null default 'active'
    check (mapping_status in ('active', 'local_deleted', 'google_deleted', 'conflict', 'detached')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_event_mappings_connection_fk
    foreign key (connection_id, couple_id, calendar_id)
    references public.google_calendar_connections(id, couple_id, calendar_id) on delete cascade,
  constraint google_calendar_event_mappings_event_key_uq
    unique (connection_id, event_key),
  constraint google_calendar_event_mappings_google_id_uq
    unique (calendar_id, google_event_id),
  constraint google_calendar_event_mappings_event_key_ck
    check (event_id is null or event_id = event_key),
  constraint google_calendar_event_mappings_version_ck
    check (last_synced_local_version is null or last_synced_local_version > 0)
);

create index google_calendar_event_mappings_couple_event_idx
  on public.google_calendar_event_mappings(couple_id, event_id);

create table public.google_calendar_sync_state (
  connection_id uuid primary key,
  couple_id uuid not null,
  sync_token text,
  watch_channel_id text,
  watch_resource_id text,
  watch_expires_at timestamptz,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  state text not null default 'idle'
    check (state in ('idle', 'queued', 'running', 'retry_wait', 'paused', 'reauth_required', 'full_sync_review')),
  pause_reason text,
  last_error_code text,
  worker_lease_id uuid,
  worker_lease_until timestamptz,
  lease_authorization_epoch bigint,
  initial_import_state text not null default 'not_started'
    check (initial_import_state in ('not_started', 'preview_ready', 'approved', 'rejected', 'complete')),
  initial_import_preview jsonb,
  deletion_candidate_count integer not null default 0 check (deletion_candidate_count >= 0),
  tracked_event_count integer not null default 0 check (tracked_event_count >= 0),
  deletion_hold_reason text,
  deletion_hold_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint google_calendar_sync_state_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_sync_state_watch_fields_ck check (
    (watch_channel_id is null and watch_resource_id is null and watch_expires_at is null)
    or (watch_channel_id is not null and watch_resource_id is not null and watch_expires_at is not null)
  ),
  constraint google_calendar_sync_state_lease_ck check (
    state <> 'running' or (worker_lease_id is not null and worker_lease_until is not null
                           and lease_authorization_epoch is not null)
  )
);

create unique index google_calendar_watch_channel_uq
  on public.google_calendar_sync_state(watch_channel_id)
  where watch_channel_id is not null;

create table public.google_calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null default gen_random_uuid() unique,
  connection_id uuid not null,
  couple_id uuid not null,
  event_key uuid not null,
  event_id uuid references public.couple_events(id) on delete set null,
  operation_type text not null check (operation_type in ('upsert', 'delete')),
  source text not null default 'app' check (source in ('app', 'google', 'restore')),
  source_version integer not null check (source_version > 0),
  event_snapshot jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry_wait', 'succeeded', 'conflict', 'dead_letter', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  lease_authorization_epoch bigint,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint google_calendar_outbox_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_outbox_idempotency_uq
    unique (connection_id, event_key, source_version, operation_type),
  constraint google_calendar_outbox_event_key_ck
    check (event_id is null or event_id = event_key),
  constraint google_calendar_outbox_lease_ck check (
    status <> 'processing' or (lease_id is not null and lease_until is not null
                               and lease_authorization_epoch is not null)
  )
);

create index google_calendar_outbox_ready_idx
  on public.google_calendar_outbox(next_attempt_at, created_at)
  where status in ('pending', 'retry_wait');

create table public.google_calendar_conflicts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  couple_id uuid not null,
  event_key uuid not null,
  event_id uuid references public.couple_events(id) on delete set null,
  conflict_type text not null
    check (conflict_type in ('both_modified', 'modify_delete', 'mapping_collision', 'unsupported_google_event')),
  base_snapshot jsonb,
  app_snapshot jsonb,
  google_snapshot jsonb,
  app_version integer,
  google_etag text,
  state text not null default 'open'
    check (state in ('open', 'app_kept', 'google_kept', 'merged', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_calendar_conflicts_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_conflicts_event_key_ck
    check (event_id is null or event_id = event_key),
  constraint google_calendar_conflicts_app_version_ck
    check (app_version is null or app_version > 0)
);

create unique index google_calendar_one_open_conflict_per_event_uq
  on public.google_calendar_conflicts(connection_id, event_key)
  where state = 'open';
create index google_calendar_conflicts_open_idx
  on public.google_calendar_conflicts(couple_id, created_at desc)
  where state = 'open';

-- Recovery is couple-owned historical data. connection_id/calendar_id are
-- source identifiers, intentionally not FK-cascaded when a connection is purged.
create table public.google_calendar_recovery_records (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  couple_id uuid not null references public.couples(id) on delete cascade,
  event_key uuid not null,
  event_id uuid,
  calendar_id text not null,
  google_event_id text,
  deleted_from text not null check (deleted_from in ('app', 'google', 'restore', 'recovery')),
  event_snapshot jsonb not null,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  recovery_status text not null default 'retained'
    check (recovery_status in ('retained', 'restore_pending', 'restored', 'expired', 'purged', 'held_for_review')),
  restored_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_calendar_recovery_event_key_ck
    check (event_id is null or event_id = event_key),
  constraint google_calendar_recovery_expiry_ck check (expires_at >= deleted_at)
);

create index google_calendar_recovery_retained_idx
  on public.google_calendar_recovery_records(couple_id, expires_at)
  where recovery_status in ('retained', 'restore_pending', 'held_for_review');

-- Store only normalized event fields. Never persist Google descriptions,
-- attendees, conferencing/HTML links, health data, or arbitrary nested payloads.
create function private.gc01_is_safe_event_snapshot(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item record;
begin
  if p_snapshot is null then
    return true;
  end if;
  if jsonb_typeof(p_snapshot) <> 'object' then
    return false;
  end if;
  for v_item in select key, value from jsonb_each(p_snapshot) loop
    if v_item.key <> all (array[
         'title', 'event_date', 'end_date', 'event_type', 'icon_key',
         'is_yearly', 'version', 'google_event_id', 'etag', 'google_updated_at'
       ])
       or jsonb_typeof(v_item.value) in ('object', 'array') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.google_calendar_event_mappings
  add constraint google_calendar_mapping_snapshot_safe_ck
    check (private.gc01_is_safe_event_snapshot(base_snapshot));
alter table public.google_calendar_outbox
  add constraint google_calendar_outbox_snapshot_safe_ck
    check (private.gc01_is_safe_event_snapshot(event_snapshot));
alter table public.google_calendar_conflicts
  add constraint google_calendar_conflict_snapshots_safe_ck
    check (private.gc01_is_safe_event_snapshot(base_snapshot)
       and private.gc01_is_safe_event_snapshot(app_snapshot)
       and private.gc01_is_safe_event_snapshot(google_snapshot));
alter table public.google_calendar_recovery_records
  add constraint google_calendar_recovery_snapshot_safe_ck
    check (private.gc01_is_safe_event_snapshot(event_snapshot));

-- Single-connection soft disconnection is represented by status. A direct
-- owner change immediately fences workers and makes the old credential usable
-- only by the dedicated token-revocation worker.
create function private.gc01_connection_owner_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    update public.google_calendar_credentials c
    set credential_status = case
          when c.refresh_token_ciphertext is null then 'revoked'
          else 'revocation_pending'
        end,
        refresh_token_ciphertext = case
          when c.refresh_token_ciphertext is null then null
          else c.refresh_token_ciphertext
        end,
        encryption_nonce = case
          when c.refresh_token_ciphertext is null then null
          else c.encryption_nonce
        end,
        encryption_key_version = case
          when c.refresh_token_ciphertext is null then null
          else c.encryption_key_version
        end,
        token_updated_at = now()
    where c.connection_id = old.id
      and c.couple_id = old.couple_id
      and c.owner_user_id is not distinct from old.owner_user_id
      and c.credential_status <> 'revoked';

    new.authorization_epoch := old.authorization_epoch + 1;
    if old.status not in ('disconnected', 'revoked') then
      new.status := 'reauth_required';
      new.last_error_code := 'authorization_owner_changed';
      new.paused_at := coalesce(new.paused_at, now());
    end if;
  end if;
  return new;
end;
$$;

create trigger aaa_google_calendar_connection_owner_transition
before update of owner_user_id on public.google_calendar_connections
for each row execute function private.gc01_connection_owner_transition();

create function private.gc01_guard_connection_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status not in ('disconnected', 'revoked') then
    raise exception 'Calendar connections must be disconnected before permanent deletion'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.google_calendar_credentials c
    where c.connection_id = old.id and c.refresh_token_ciphertext is not null
  ) then
    raise exception 'Google credentials must be revoked and scrubbed before connection deletion'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from public.google_calendar_outbox o
    where o.connection_id = old.id and o.status in ('pending', 'processing', 'retry_wait')
  ) or exists (
    select 1 from public.google_calendar_conflicts c
    where c.connection_id = old.id and c.state = 'open'
  ) or exists (
    select 1 from public.google_calendar_sync_state s
    where s.connection_id = old.id and s.state = 'running'
      and s.worker_lease_until > now()
  ) then
    raise exception 'Pending sync work, active worker lease, or open conflict blocks connection deletion'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger google_calendar_connection_hard_delete_guard
before delete on public.google_calendar_connections
for each row execute function private.gc01_guard_connection_hard_delete();

create function private.gc01_validate_credential_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  -- Auth-user deletion preserves the encrypted token only for revocation work.
  if tg_op = 'UPDATE' and new.credential_status = 'revocation_pending' then
    return new;
  end if;

  select c.owner_user_id, c.status into v_owner, v_status
  from public.google_calendar_connections c
  where c.id = new.connection_id and c.couple_id = new.couple_id
  for share;

  if not found or v_owner is distinct from new.owner_user_id
     or v_status in ('disconnected', 'revoked') then
    raise exception 'Google credential owner does not match an eligible connection'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger google_calendar_credential_owner_check
before insert or update of connection_id, couple_id, owner_user_id, credential_status
on public.google_calendar_credentials
for each row execute function private.gc01_validate_credential_owner();

create function private.gc01_require_credential_for_active_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential_id uuid;
begin
  if new.status = 'active' then
    select c.connection_id into v_credential_id
    from public.google_calendar_credentials c
    where c.connection_id = new.id
      and c.couple_id = new.couple_id
      and c.owner_user_id = new.owner_user_id
      and c.credential_status = 'active'
      and c.refresh_token_ciphertext is not null
      and c.encryption_nonce is not null
    for share;
    if not found then
      raise exception 'Active calendar connection requires an active owner credential'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger google_calendar_connection_activation_guard
before insert or update of status, owner_user_id on public.google_calendar_connections
for each row execute function private.gc01_require_credential_for_active_connection();

-- A parent event is locked FOR SHARE while a mapping/outbox/conflict is linked.
-- This serializes concurrent couple_id changes against creation of a link.
create function private.gc01_validate_event_couple()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_couple uuid;
  v_identity_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_identity_changed := true;
  else
    v_identity_changed := new.event_id is distinct from old.event_id
      or new.event_key is distinct from old.event_key
      or new.couple_id is distinct from old.couple_id;
  end if;

  if v_identity_changed and new.event_id is not null then
    if new.event_id <> new.event_key then
      raise exception 'event_id must match the persistent event_key'
        using errcode = '23514';
    end if;

    select e.couple_id into v_event_couple
    from public.couple_events e
    where e.id = new.event_id
    for share;

    if not found or v_event_couple is distinct from new.couple_id then
      raise exception 'event_id does not belong to couple_id'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger google_calendar_mapping_event_couple_check
before insert or update on public.google_calendar_event_mappings
for each row execute function private.gc01_validate_event_couple();
create trigger google_calendar_outbox_event_couple_check
before insert or update on public.google_calendar_outbox
for each row execute function private.gc01_validate_event_couple();
create trigger google_calendar_conflict_event_couple_check
before insert or update on public.google_calendar_conflicts
for each row execute function private.gc01_validate_event_couple();
create trigger google_calendar_recovery_event_couple_check
before insert or update on public.google_calendar_recovery_records
for each row execute function private.gc01_validate_event_couple();

create function private.gc01_guard_linked_event_couple_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.couple_id is distinct from old.couple_id and (
    exists (select 1 from public.google_calendar_event_mappings m
            where m.event_key = old.id or m.event_id = old.id)
    or exists (select 1 from public.google_calendar_outbox o
               where o.event_key = old.id or o.event_id = old.id)
    or exists (select 1 from public.google_calendar_conflicts c
               where c.event_key = old.id or c.event_id = old.id)
    or exists (select 1 from public.google_calendar_recovery_records r
               where r.event_key = old.id or r.event_id = old.id)
  ) then
    raise exception 'A linked event cannot be reassigned to another couple'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Runs before the existing couple_events_stamp trigger alphabetically and
-- protects linked events even for privileged writers that bypass client grants.
create trigger aaa_gc01_linked_event_couple_guard
before update of couple_id on public.couple_events
for each row execute function private.gc01_guard_linked_event_couple_change();

-- Recovery records retain connection_id as a historical source key without an
-- FK. Lock the live connection while validating so hard-delete races serialize.
create function private.gc01_validate_recovery_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_couple uuid;
  v_calendar text;
  v_identity_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_identity_changed := true;
  else
    v_identity_changed := new.connection_id is distinct from old.connection_id
      or new.couple_id is distinct from old.couple_id
      or new.calendar_id is distinct from old.calendar_id;
  end if;

  if v_identity_changed then
    select c.couple_id, c.calendar_id into v_couple, v_calendar
    from public.google_calendar_connections c
    where c.id = new.connection_id
    for key share;

    if not found or v_couple is distinct from new.couple_id
       or v_calendar is distinct from new.calendar_id then
      raise exception 'Recovery record does not match its originating connection'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger google_calendar_recovery_connection_check
before insert or update on public.google_calendar_recovery_records
for each row execute function private.gc01_validate_recovery_connection();

create function private.gc01_require_active_worker_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch bigint;
  v_owner uuid;
  v_status text;
begin
  if new.state <> 'running' then
    return new;
  end if;

  select c.authorization_epoch, c.owner_user_id, c.status
    into v_epoch, v_owner, v_status
  from public.google_calendar_connections c
  where c.id = new.connection_id and c.couple_id = new.couple_id
  for share;

  if not found or v_status <> 'active'
     or new.lease_authorization_epoch is distinct from v_epoch then
    raise exception 'Worker lease is stale or connection is not active'
      using errcode = '55000';
  end if;

  perform 1 from public.google_calendar_credentials c
  where c.connection_id = new.connection_id and c.couple_id = new.couple_id
    and c.owner_user_id = v_owner and c.credential_status = 'active'
    and c.refresh_token_ciphertext is not null
  for share;
  if not found then
    raise exception 'Worker requires the active connection owner credential'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger google_calendar_sync_active_lease_guard
before insert or update of state, lease_authorization_epoch
on public.google_calendar_sync_state
for each row execute function private.gc01_require_active_worker_lease();

create function private.gc01_require_active_outbox_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch bigint;
  v_owner uuid;
  v_status text;
begin
  if new.status <> 'processing' then
    return new;
  end if;

  select c.authorization_epoch, c.owner_user_id, c.status
    into v_epoch, v_owner, v_status
  from public.google_calendar_connections c
  where c.id = new.connection_id and c.couple_id = new.couple_id
  for share;

  if not found or v_status <> 'active'
     or new.lease_authorization_epoch is distinct from v_epoch then
    raise exception 'Outbox lease is stale or connection is not active'
      using errcode = '55000';
  end if;

  perform 1 from public.google_calendar_credentials c
  where c.connection_id = new.connection_id and c.couple_id = new.couple_id
    and c.owner_user_id = v_owner and c.credential_status = 'active'
    and c.refresh_token_ciphertext is not null
  for share;
  if not found then
    raise exception 'Outbox worker requires the active connection owner credential'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger google_calendar_outbox_active_lease_guard
before insert or update of status, lease_authorization_epoch
on public.google_calendar_outbox
for each row execute function private.gc01_require_active_outbox_lease();

-- No browser/mobile role can call these trigger functions as RPCs.
revoke execute on function private.gc01_connection_owner_transition() from public, anon, authenticated;
revoke execute on function private.gc01_guard_connection_hard_delete() from public, anon, authenticated;
revoke execute on function private.gc01_validate_credential_owner() from public, anon, authenticated;
revoke execute on function private.gc01_require_credential_for_active_connection() from public, anon, authenticated;
revoke execute on function private.gc01_validate_event_couple() from public, anon, authenticated;
revoke execute on function private.gc01_guard_linked_event_couple_change() from public, anon, authenticated;
revoke execute on function private.gc01_validate_recovery_connection() from public, anon, authenticated;
revoke execute on function private.gc01_require_active_worker_lease() from public, anon, authenticated;
revoke execute on function private.gc01_require_active_outbox_lease() from public, anon, authenticated;
revoke execute on function private.gc01_is_safe_event_snapshot(jsonb) from public, anon, authenticated;
grant execute on function private.gc01_is_safe_event_snapshot(jsonb) to service_role;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_credentials enable row level security;
alter table public.google_calendar_event_mappings enable row level security;
alter table public.google_calendar_sync_state enable row level security;
alter table public.google_calendar_outbox enable row level security;
alter table public.google_calendar_conflicts enable row level security;
alter table public.google_calendar_recovery_records enable row level security;

revoke all on public.google_calendar_connections from public, anon, authenticated;
revoke all on public.google_calendar_credentials from public, anon, authenticated;
revoke all on public.google_calendar_event_mappings from public, anon, authenticated;
revoke all on public.google_calendar_sync_state from public, anon, authenticated;
revoke all on public.google_calendar_outbox from public, anon, authenticated;
revoke all on public.google_calendar_conflicts from public, anon, authenticated;
revoke all on public.google_calendar_recovery_records from public, anon, authenticated;

-- Only safe status columns are exposed. Snapshot JSON and token material are
-- inaccessible to clients even for members; detailed data must come through
-- an authenticated Edge Function that sanitizes the response.
grant select (
  id, couple_id, calendar_id, calendar_summary, calendar_timezone, owner_user_id,
  status, partner_access_verified_at, last_verified_at, last_success_at,
  last_error_code, paused_at, created_at, updated_at
) on public.google_calendar_connections to authenticated;
grant select (
  id, couple_id, event_key, conflict_type, app_version, state, resolved_at, created_at
) on public.google_calendar_conflicts to authenticated;
grant select (
  id, couple_id, event_key, calendar_id, deleted_from, deleted_at, expires_at,
  recovery_status, restored_at, created_at
) on public.google_calendar_recovery_records to authenticated;

grant all on public.google_calendar_connections to service_role;
grant all on public.google_calendar_credentials to service_role;
grant all on public.google_calendar_event_mappings to service_role;
grant all on public.google_calendar_sync_state to service_role;
grant all on public.google_calendar_outbox to service_role;
grant all on public.google_calendar_conflicts to service_role;
grant all on public.google_calendar_recovery_records to service_role;
grant usage on schema private to service_role;

create policy google_calendar_connections_member_read
  on public.google_calendar_connections for select to authenticated
  using (private.is_member(couple_id));
create policy google_calendar_conflicts_member_read
  on public.google_calendar_conflicts for select to authenticated
  using (private.is_member(couple_id));
create policy google_calendar_recovery_member_read
  on public.google_calendar_recovery_records for select to authenticated
  using (private.is_member(couple_id));

comment on table public.google_calendar_credentials is
  'Server-only encrypted Google refresh credentials; ciphertext is retained only while active or pending server-side revocation.';
comment on column public.google_calendar_credentials.refresh_token_ciphertext is
  'AES-256-GCM ciphertext; encryption key is held only in Supabase Edge Function secrets or an approved KMS.';
comment on table public.google_calendar_outbox is
  'Server-only idempotent queue; processing requires an active owner credential and matching authorization epoch.';
comment on table public.google_calendar_recovery_records is
  'Couple-scoped 30-day tombstone snapshots; connection_id is historical and does not cascade on connection deletion.';
