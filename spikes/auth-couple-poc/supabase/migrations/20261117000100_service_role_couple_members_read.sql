-- Allow server-side Edge Functions to verify couple membership.
-- RLS remains enabled; this does not grant access to anon/authenticated clients.
GRANT SELECT ON TABLE public.couple_members TO service_role;
