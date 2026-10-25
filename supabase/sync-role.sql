-- One-time setup for the GitHub Actions content sync (.github/workflows/sync-content-ids.yml).
-- Creates a login role that can only maintain the id list in public.content_items: it cannot read or change
-- content_likes, cannot delete rows, and cannot touch any other table. Tables, RLS and existing policies are unchanged;
-- this only adds the role, its grants and one policy scoped to that role.
-- 1. Replace the password below with a long random one (never commit the real password).
-- 2. Run this file once in the Supabase SQL editor.
-- 3. Save the Session pooler connection string for this role as the GitHub secret SUPABASE_SYNC_DB_URL.

create role content_sync with login noinherit password 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
alter role content_sync set statement_timeout = '30s';

grant usage on schema public to content_sync;
grant select, insert (id), update (active, updated_at) on public.content_items to content_sync;

-- content_items has RLS enabled; this policy applies to the sync role only.
create policy "content sync maintains ids" on public.content_items
  for all to content_sync using (true) with check (true);
