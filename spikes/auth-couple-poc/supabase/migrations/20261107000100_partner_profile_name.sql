-- Expose only the paired user's display name; keep profiles RLS owner-only.
create or replace function public.get_partner_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select partner_profile.private_name
  from public.couple_members as me
  join public.couple_members as partner
    on partner.couple_id = me.couple_id
   and partner.user_id <> me.user_id
  join public.profiles as partner_profile
    on partner_profile.user_id = partner.user_id
  where me.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.get_partner_name() from public, anon;
grant execute on function public.get_partner_name() to authenticated;
