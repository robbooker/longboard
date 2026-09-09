-- Private workbook answers; the composite key also indexes the ownership check.
create table public.workbook_responses (
  user_id uuid not null references auth.users(id) on delete cascade,
  workbook_slug text not null check (workbook_slug ~ '^[a-z0-9-]{1,80}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object' and octet_length(response::text) <= 150000),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, workbook_slug)
);
alter table public.workbook_responses enable row level security;
revoke all on public.workbook_responses from anon, authenticated;
grant select, insert, update on public.workbook_responses to authenticated;
grant all on public.workbook_responses to service_role;
create policy "Read own workbook" on public.workbook_responses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Create own workbook" on public.workbook_responses for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own workbook" on public.workbook_responses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
