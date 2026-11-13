-- Users may have registered with Supabase Auth before the application schema existed.
-- Keep existing names and timestamps; only create missing application profiles.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
