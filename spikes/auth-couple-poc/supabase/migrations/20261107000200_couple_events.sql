-- User-approved policy: both members of a couple can manage shared events.
create table public.couple_events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  event_date date not null,
  event_type text not null check (event_type in ('anniversary', 'event')),
  icon_key text check (
    icon_key is null or icon_key in ('heart', 'calendar', 'home', 'drop', 'book')
  ),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create index couple_events_date_idx on public.couple_events(couple_id, event_date, id);

create function private.stamp_couple_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.version := 1;
  else
    new.couple_id := old.couple_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.stamp_couple_event() from public, anon, authenticated;

create trigger couple_events_stamp
before insert or update on public.couple_events
for each row execute function private.stamp_couple_event();

alter table public.couple_events enable row level security;
revoke all on public.couple_events from anon, authenticated;
grant select, delete on public.couple_events to authenticated;
grant insert(couple_id, title, event_date, event_type, icon_key)
  on public.couple_events to authenticated;
grant update(title, event_date, event_type, icon_key)
  on public.couple_events to authenticated;

create policy couple_events_read on public.couple_events
  for select to authenticated using (private.is_member(couple_id));
create policy couple_events_create on public.couple_events
  for insert to authenticated with check (private.is_member(couple_id));
create policy couple_events_edit on public.couple_events
  for update to authenticated using (private.is_member(couple_id))
  with check (private.is_member(couple_id));
create policy couple_events_delete on public.couple_events
  for delete to authenticated using (private.is_member(couple_id));
