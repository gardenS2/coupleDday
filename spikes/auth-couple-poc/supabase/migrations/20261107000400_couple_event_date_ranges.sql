-- Store a date range on one event row. Existing rows stay single-day events.
alter table public.couple_events
  add column end_date date,
  add constraint couple_events_date_range_check
    check (end_date is null or end_date >= event_date);

create index couple_events_end_date_idx
  on public.couple_events(couple_id, end_date)
  where end_date is not null;

grant insert(end_date), update(end_date)
  on public.couple_events to authenticated;

comment on column public.couple_events.event_date is
  'Start date for an event; remains the date for existing single-day events.';
comment on column public.couple_events.end_date is
  'Inclusive end date for a multi-day event; null means a single-day event.';
