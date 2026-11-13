-- GC-01 REVIEW FIXES ONLY. NOT APPLIED.
-- Apply only after separately approving and applying GC-01-google-calendar-sync.sql.
-- This patch addresses static-review findings; it does not modify couple_events.

begin;

-- A connection owner deletion must not leave an apparently usable pipeline.
alter table public.google_calendar_connections
  drop constraint google_calendar_connections_active_fields_ck,
  add constraint google_calendar_connections_active_fields_ck
    check (status <> 'active' or (calendar_id is not null and owner_user_id is not null));

create or replace function private.gc01_mark_owner_removed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owner_user_id is not null and new.owner_user_id is null
     and old.status not in ('disconnected', 'revoked') then
    new.status := 'reauth_required';
    new.last_error_code := 'authorization_owner_removed';
    new.paused_at := coalesce(new.paused_at, now());
  end if;
  return new;
end;
$$;

revoke execute on function private.gc01_mark_owner_removed() from public, anon, authenticated;
create trigger google_calendar_connection_owner_removed
before update of owner_user_id on public.google_calendar_connections
for each row execute function private.gc01_mark_owner_removed();

-- Refresh credentials must belong to the approved owner of this connection.
create or replace function private.gc01_validate_credential_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select c.owner_user_id, c.status into v_owner, v_status
  from public.google_calendar_connections c
  where c.id = new.connection_id and c.couple_id = new.couple_id;

  if not found or v_owner is distinct from new.owner_user_id
     or v_status in ('disconnected', 'revoked') then
    raise exception 'Google credential owner does not match an eligible connection'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.gc01_validate_credential_owner() from public, anon, authenticated;
create trigger google_calendar_credential_owner_check
before insert or update of connection_id, couple_id, owner_user_id
on public.google_calendar_credentials
for each row execute function private.gc01_validate_credential_owner();

-- Revocation/invalid_grant handlers must scrub the stored token material.
alter table public.google_calendar_credentials
  alter column refresh_token_ciphertext drop not null,
  alter column encryption_nonce drop not null,
  add constraint google_calendar_credentials_active_token_ck check (
    credential_status <> 'active'
    or (refresh_token_ciphertext is not null and encryption_nonce is not null)
  );

-- Do not leave an open duplicate conflict for the same event/pipeline.
create unique index google_calendar_one_open_conflict_per_event_uq
  on public.google_calendar_conflicts(connection_id, event_key)
  where state = 'open';

-- Every queued operation needs its point-in-time payload. Keep its event UUID
-- after hard deletion via event_key; event_id is cleared by the FK.
alter table public.google_calendar_outbox
  alter column event_snapshot set not null,
  add constraint google_calendar_outbox_event_fk
    foreign key (event_id) references public.couple_events(id) on delete set null;

-- Persist why/how many deletion candidates caused a destructive-sync hold.
alter table public.google_calendar_sync_state
  add column deletion_candidate_count integer not null default 0
    check (deletion_candidate_count >= 0),
  add column tracked_event_count integer not null default 0
    check (tracked_event_count >= 0),
  add column deletion_hold_reason text,
  add column deletion_hold_at timestamptz;

alter table public.google_calendar_event_mappings
  add constraint google_calendar_mapping_event_key_ck
    check (event_id is null or event_id = event_key);
alter table public.google_calendar_outbox
  add constraint google_calendar_outbox_event_key_ck
    check (event_id is null or event_id = event_key);
alter table public.google_calendar_conflicts
  add constraint google_calendar_conflict_event_key_ck
    check (event_id is null or event_id = event_key);
alter table public.google_calendar_recovery_records
  add constraint google_calendar_recovery_event_key_ck
    check (event_id is null or event_id = event_key);

-- FKs to couple_events(id) alone cannot prove couple ownership. Enforce that
-- relationship in the database without adding an index/constraint to that
-- existing table. For historical recovery rows, validate on insert or when
-- their event identity changes; later state transitions remain possible.
create or replace function private.gc01_validate_event_couple()
returns trigger
language plpgsql
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
    where e.id = new.event_id;

    if not found or v_event_couple is distinct from new.couple_id then
      raise exception 'event_id does not belong to couple_id'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.gc01_validate_event_couple() from public, anon, authenticated;
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

-- Recovery is historical data and must outlive connection teardown. Scope it
-- to the couple (whose deletion intentionally erases all couple-owned data),
-- and retain connection_id/calendar_id as historical identifiers without an
-- ON DELETE CASCADE FK to the connection row.
alter table public.google_calendar_recovery_records
  drop constraint google_calendar_recovery_connection_fk,
  add constraint google_calendar_recovery_couple_fk
    foreign key (couple_id) references public.couples(id) on delete cascade;

create or replace function private.gc01_validate_recovery_connection()
returns trigger
language plpgsql
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
    where c.id = new.connection_id;

    if not found or v_couple is distinct from new.couple_id
       or v_calendar is distinct from new.calendar_id then
      raise exception 'recovery record does not match its originating connection'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.gc01_validate_recovery_connection() from public, anon, authenticated;
create trigger google_calendar_recovery_connection_check
before insert or update on public.google_calendar_recovery_records
for each row execute function private.gc01_validate_recovery_connection();

-- Partial unique watch channel prevents accidentally sharing one webhook
-- channel identifier across pipeline rows.
create unique index google_calendar_watch_channel_uq
  on public.google_calendar_sync_state(watch_channel_id)
  where watch_channel_id is not null;

commit;
