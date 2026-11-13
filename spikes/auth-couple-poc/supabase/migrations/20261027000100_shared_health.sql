-- 2026-10-27 user decision: health data belongs to the couple, not private author storage.
create extension if not exists btree_gist with schema extensions;
create table public.cycle_records (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  start_date date not null,
  end_date date,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check(end_date is null or end_date >= start_date),
  exclude using gist(couple_id with =, daterange(start_date,end_date,'[]') with &&)
);
create table public.cycle_daily_logs (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  log_date date not null,
  symptoms text[] not null default '{}' check(symptoms <@ array['복통','두통','요통','피곤','여드름','붓기','예민함','식욕 증가']::text[]),
  mood text check(mood in ('좋아요','평온해요','울적해요','예민해요')),
  memo text not null default '' check(char_length(memo)<=300),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(couple_id,log_date)
);
create function private.health_stamp() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then new.created_by=auth.uid(); new.created_at=now(); new.version=1;
  else new.version=old.version+1; end if;
  new.updated_by=auth.uid(); new.updated_at=now(); return new;
end; $$;
revoke execute on function private.health_stamp() from public,anon,authenticated;
create trigger stamp_cycle before insert or update on public.cycle_records for each row execute function private.health_stamp();
create trigger stamp_daily before insert or update on public.cycle_daily_logs for each row execute function private.health_stamp();
alter table public.cycle_records enable row level security;
alter table public.cycle_daily_logs enable row level security;
revoke all on public.cycle_records, public.cycle_daily_logs from anon,authenticated;
grant select,delete on public.cycle_records,public.cycle_daily_logs to authenticated;
grant insert(couple_id,start_date,end_date) on public.cycle_records to authenticated;
grant update(start_date,end_date) on public.cycle_records to authenticated;
grant insert(couple_id,log_date,symptoms,mood,memo) on public.cycle_daily_logs to authenticated;
grant update(log_date,symptoms,mood,memo) on public.cycle_daily_logs to authenticated;
create policy cycle_read on public.cycle_records for select to authenticated using(private.is_member(couple_id));
create policy cycle_create on public.cycle_records for insert to authenticated with check(private.is_member(couple_id));
create policy cycle_edit on public.cycle_records for update to authenticated using(private.is_member(couple_id)) with check(private.is_member(couple_id));
create policy cycle_delete on public.cycle_records for delete to authenticated using(private.is_member(couple_id));
create policy daily_read on public.cycle_daily_logs for select to authenticated using(private.is_member(couple_id));
create policy daily_create on public.cycle_daily_logs for insert to authenticated with check(private.is_member(couple_id));
create policy daily_edit on public.cycle_daily_logs for update to authenticated using(private.is_member(couple_id)) with check(private.is_member(couple_id));
create policy daily_delete on public.cycle_daily_logs for delete to authenticated using(private.is_member(couple_id));
