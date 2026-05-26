-- Frontend uses Supabase anon key (no Supabase Auth session).
-- programme_stream_quotas previously had authenticated-only RLS → 401 for Quota tab.

grant select, insert, update, delete
  on public.programme_stream_quotas
  to anon;

drop policy if exists "Allow anon all programme_stream_quotas"
  on public.programme_stream_quotas;

create policy "Allow anon all programme_stream_quotas"
  on public.programme_stream_quotas
  for all
  to anon
  using (true)
  with check (true);
