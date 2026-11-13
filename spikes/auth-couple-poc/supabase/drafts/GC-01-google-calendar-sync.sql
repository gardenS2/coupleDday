-- GC-01 REVIEW DRAFT ONLY. NOT APPLIED.
-- Keep this outside supabase/migrations until the user approves the schema.
-- Additive schema: does not alter couple_events, existing RLS, or user data.
-- Server-side functions must verify the caller's Supabase identity and couple
-- membership before using service_role; service_role must never reach the app.

begin;

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
      'permission_lost', 'error', 'recovery_review', 'disconnected', 'revoked'
    )),
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
    status <> 'active' or calendar_id is not null
  )
);

-- Keep disconnected/revoked connection history while allowing one live pipeline.
create unique index google_calendar_one_live_connection_per_couple_uq
  on public.google_calendar_connections(couple_id)
  where status not in ('disconnected', 'revoked');

create table public.google_calendar_credentials (
  connection_id uuid primary key,
  couple_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  google_sub text not null,
  refresh_token_ciphertext bytea not null,
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  encryption_key_version text not null,
  granted_scopes text[] not null default '{}',
  credential_status text not null default 'active'
    check (credential_status in ('active', 'reauth_required', 'revoked')),
  last_refreshed_at timestamptz,
  token_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint google_calendar_credentials_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_credentials_one_google_identity_uq
    unique (connection_id, google_sub)
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
  constraint google_calendar_event_mappings_nonnegative_version_ck
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
  initial_import_state text not null default 'not_started'
    check (initial_import_state in ('not_started', 'preview_ready', 'approved', 'rejected', 'complete')),
  initial_import_preview jsonb,
  updated_at timestamptz not null default now(),
  constraint google_calendar_sync_state_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_sync_state_watch_fields_ck check (
    watch_channel_id is null or (watch_resource_id is not null and watch_expires_at is not null)
  )
);

create table public.google_calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null default gen_random_uuid() unique,
  connection_id uuid not null,
  couple_id uuid not null,
  event_key uuid not null,
  event_id uuid,
  operation_type text not null check (operation_type in ('upsert', 'delete')),
  source text not null default 'app' check (source in ('app', 'google', 'restore')),
  source_version integer not null,
  event_snapshot jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry_wait', 'succeeded', 'conflict', 'dead_letter', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint google_calendar_outbox_connection_fk
    foreign key (connection_id, couple_id)
    references public.google_calendar_connections(id, couple_id) on delete cascade,
  constraint google_calendar_outbox_idempotency_uq
    unique (connection_id, event_key, source_version, operation_type),
  constraint google_calendar_outbox_version_ck check (source_version > 0)
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
  conflict_type text not null check (conflict_type in ('both_modified', 'modify_delete', 'mapping_collision', 'unsupported_google_event')),
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
    references public.google_calendar_connections(id, couple_id) on delete cascade
);

create index google_calendar_conflicts_open_idx
  on public.google_calendar_conflicts(couple_id, created_at desc)
  where state = 'open';

create table public.google_calendar_recovery_records (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  couple_id uuid not null,
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
  constraint google_calendar_recovery_connection_fk
    foreign key (connection_id, couple_id, calendar_id)
    references public.google_calendar_connections(id, couple_id, calendar_id) on delete cascade,
  constraint google_calendar_recovery_expiry_ck check (expires_at >= deleted_at)
);

create index google_calendar_recovery_retained_idx
  on public.google_calendar_recovery_records(couple_id, expires_at)
  where recovery_status in ('retained', 'restore_pending', 'held_for_review');

-- RLS: members may read safe connection status, conflict summaries/snapshots,
-- and recovery records. No mobile client may write these records directly.
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_conflicts enable row level security;
alter table public.google_calendar_recovery_records enable row level security;

revoke all on public.google_calendar_connections from public, anon, authenticated;
revoke all on public.google_calendar_conflicts from public, anon, authenticated;
revoke all on public.google_calendar_recovery_records from public, anon, authenticated;
grant select on public.google_calendar_connections to authenticated;
grant select on public.google_calendar_conflicts to authenticated;
grant select on public.google_calendar_recovery_records to authenticated;
grant all on public.google_calendar_connections to service_role;
grant all on public.google_calendar_conflicts to service_role;
grant all on public.google_calendar_recovery_records to service_role;

create policy google_calendar_connections_member_read
  on public.google_calendar_connections for select to authenticated
  using (private.is_member(couple_id));
create policy google_calendar_conflicts_member_read
  on public.google_calendar_conflicts for select to authenticated
  using (private.is_member(couple_id));
create policy google_calendar_recovery_member_read
  on public.google_calendar_recovery_records for select to authenticated
  using (private.is_member(couple_id));

-- Credentials, mappings, worker state, and queues are server-only.
alter table public.google_calendar_credentials enable row level security;
alter table public.google_calendar_event_mappings enable row level security;
alter table public.google_calendar_sync_state enable row level security;
alter table public.google_calendar_outbox enable row level security;

revoke all on public.google_calendar_credentials from public, anon, authenticated;
revoke all on public.google_calendar_event_mappings from public, anon, authenticated;
revoke all on public.google_calendar_sync_state from public, anon, authenticated;
revoke all on public.google_calendar_outbox from public, anon, authenticated;
grant all on public.google_calendar_credentials to service_role;
grant all on public.google_calendar_event_mappings to service_role;
grant all on public.google_calendar_sync_state to service_role;
grant all on public.google_calendar_outbox to service_role;

comment on table public.google_calendar_credentials is
  'Server-only encrypted Google refresh credentials. Never expose ciphertext/plaintext or service_role to mobile clients.';
comment on column public.google_calendar_credentials.refresh_token_ciphertext is
  'AES-256-GCM ciphertext encrypted/decrypted only by trusted server code using a Supabase Edge Function secret.';
comment on table public.google_calendar_outbox is
  'Server-only idempotent queue. Worker must use leases, retry backoff, ETag preconditions, and safe insert retries.';
comment on table public.google_calendar_recovery_records is
  '30-day event snapshots/tombstones. Permission errors, empty scans, and expired sync tokens must never be treated as deletions.';

commit;
