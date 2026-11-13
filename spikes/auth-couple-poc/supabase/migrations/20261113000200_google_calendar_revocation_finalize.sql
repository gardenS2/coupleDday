-- GC-01 follow-up: allow the server-only revocation worker to finalize an old
-- owner's pending credential after the connection owner has been removed or
-- changed. The historical owner/connection identity remains immutable.
create or replace function private.gc01_validate_credential_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  -- Owner changes intentionally preserve the old token only for server-side
  -- revocation retries. Finalization may scrub it, but cannot rewrite identity.
  if tg_op = 'UPDATE' and new.credential_status = 'revocation_pending' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.credential_status = 'revocation_pending'
     and new.credential_status = 'revoked'
     and new.connection_id = old.connection_id
     and new.couple_id = old.couple_id
     and new.owner_user_id is not distinct from old.owner_user_id then
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
