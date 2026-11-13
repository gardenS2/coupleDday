-- Local phase-1 spike. No remote project is linked or modified.
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  private_name text not null default '' check (char_length(private_name) <= 40),
  created_at timestamptz not null default now()
);
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  relationship_start date not null,
  created_at timestamptz not null default now()
);
create table public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid primary key references auth.users(id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  joined_at timestamptz not null default now(),
  unique (couple_id, slot)
);
create table public.couple_invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index on public.couple_invites(couple_id);
create index on public.couple_invites(created_by, created_at);

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_invites enable row level security;
revoke all on public.profiles, public.couples, public.couple_members, public.couple_invites from anon, authenticated;
grant select on public.profiles, public.couples, public.couple_members to authenticated;
grant update (private_name) on public.profiles to authenticated;
-- relationship_start edits deliberately go through an RPC for validation.

create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values(new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.create_profile();

create function private.is_member(p_couple uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.couple_members
    where couple_id = p_couple and user_id = (select auth.uid()));
$$;
create policy profiles_read on public.profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy couples_read on public.couples for select to authenticated
using (private.is_member(id));
create policy members_read on public.couple_members for select to authenticated
using (private.is_member(couple_id));
-- No invite table policies/grants: hashes and other users' invitations never leave RPCs.

create function public.create_couple(p_relationship_start date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  if p_relationship_start is null or p_relationship_start > (now() at time zone 'Asia/Seoul')::date then
    raise exception 'invalid_start_date' using errcode='22023';
  end if;
  if exists(select 1 from public.couple_members where user_id=v_user) then
    raise exception 'already_joined' using errcode='23505';
  end if;
  insert into public.couples(relationship_start) values(p_relationship_start) returning id into v_id;
  insert into public.couple_members(couple_id,user_id,slot) values(v_id,v_user,1);
  return v_id;
end; $$;

create function public.create_couple_invite()
returns table(invite_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_couple uuid; v_token text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  select m.couple_id into v_couple from public.couple_members m where m.user_id=v_user;
  if v_couple is null then raise exception 'membership_required' using errcode='42501'; end if;
  perform 1 from public.couples where id=v_couple for update;
  if (select count(*) from public.couple_members where couple_id=v_couple) >= 2 then
    raise exception 'couple_full' using errcode='23514';
  end if;
  if (select count(*) from public.couple_invites where created_by=v_user and created_at > now()-interval '1 hour') >= 5 then
    raise exception 'invite_rate_limit' using errcode='54000';
  end if;
  update public.couple_invites set revoked_at=now()
    where couple_id=v_couple and consumed_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  return query insert into public.couple_invites(couple_id,created_by,token_hash,expires_at)
    values(v_couple,v_user,extensions.digest(v_token,'sha256'),now()+interval '24 hours')
    returning id,v_token,public.couple_invites.expires_at;
end; $$;

create function public.accept_couple_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_couple uuid; v_inv public.couple_invites%rowtype; v_slot smallint;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_invite' using errcode='22023';
  end if;
  select couple_id into v_couple from public.couple_invites where token_hash=extensions.digest(p_token,'sha256');
  if v_couple is null then raise exception 'invalid_invite' using errcode='22023'; end if;
  perform 1 from public.couples where id=v_couple for update;
  select * into v_inv from public.couple_invites where token_hash=extensions.digest(p_token,'sha256') for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'invalid_invite' using errcode='22023';
  end if;
  if v_inv.consumed_by=v_user and private.is_member(v_couple) then return v_couple; end if;
  if v_inv.consumed_at is not null or v_inv.created_by=v_user then
    raise exception 'invalid_invite' using errcode='22023';
  end if;
  if exists(select 1 from public.couple_members where user_id=v_user) then
    raise exception 'already_joined' using errcode='23505';
  end if;
  select s::smallint into v_slot from generate_series(1,2) s
    where not exists(select 1 from public.couple_members where couple_id=v_couple and slot=s)
    order by s limit 1;
  if v_slot is null then raise exception 'couple_full' using errcode='23514'; end if;
  insert into public.couple_members(couple_id,user_id,slot) values(v_couple,v_user,v_slot);
  update public.couple_invites set consumed_at=now(),consumed_by=v_user where id=v_inv.id;
  return v_couple;
end; $$;

create function public.revoke_couple_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_couple uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  select couple_id into v_couple from public.couple_members where user_id=v_user;
  if v_couple is null then raise exception 'membership_required' using errcode='42501'; end if;
  perform 1 from public.couples where id=v_couple for update;
  update public.couple_invites set revoked_at=now()
    where id=p_invite_id and couple_id=v_couple and created_by=v_user and consumed_at is null;
  -- Do not reveal whether another user's invite id exists.
end; $$;

create function public.set_relationship_start(p_relationship_start date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_couple uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  select couple_id into v_couple from public.couple_members where user_id=v_user;
  if v_couple is null then raise exception 'membership_required' using errcode='42501'; end if;
  if p_relationship_start is null or p_relationship_start > (now() at time zone 'Asia/Seoul')::date then
    raise exception 'invalid_start_date' using errcode='22023';
  end if;
  update public.couples set relationship_start=p_relationship_start where id=v_couple;
end; $$;

create function public.leave_couple() returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_couple uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform 1 from auth.users where id=v_user for update;
  select couple_id into v_couple from public.couple_members where user_id=v_user;
  if v_couple is null then return; end if;
  perform 1 from public.couples where id=v_couple for update;
  delete from public.couple_members where user_id=v_user;
  update public.couple_invites set revoked_at=now() where couple_id=v_couple and revoked_at is null;
  if not exists(select 1 from public.couple_members where couple_id=v_couple) then
    delete from public.couples where id=v_couple;
  end if;
end; $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
revoke execute on function public.create_couple(date), public.create_couple_invite(),
  public.accept_couple_invite(text), public.revoke_couple_invite(uuid),
  public.set_relationship_start(date), public.leave_couple() from public, anon;
grant execute on function public.create_couple(date), public.create_couple_invite(),
  public.accept_couple_invite(text), public.revoke_couple_invite(uuid),
  public.set_relationship_start(date), public.leave_couple() to authenticated;
