-- Adds opt-in solar-calendar yearly recurrence to existing couple events.
-- Existing events remain one-time events via the false default.
alter table public.couple_events
  add column is_yearly boolean not null default false;

grant insert(is_yearly), update(is_yearly)
  on public.couple_events to authenticated;

comment on column public.couple_events.is_yearly is
  'When true, repeat this anniversary on the same solar month/day each year. February 29 has no occurrence in non-leap years.';
