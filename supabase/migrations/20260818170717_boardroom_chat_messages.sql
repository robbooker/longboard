-- Boardroom Chat — one realtime room per Boardroom cohort.
--
-- Members can read and post only in cohorts granted by their existing
-- boardroom-cohort-* user tag. The author label is derived from the trusted
-- profiles row by a locked trigger, so clients cannot impersonate another
-- member by choosing a display name in the insert payload.

create table public.boardroom_chat_messages (
  id uuid primary key default gen_random_uuid(),
  cohort text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_label text not null,
  body text not null check (
    char_length(btrim(body)) between 1 and 600
  ),
  created_at timestamptz not null default now()
);

create index boardroom_chat_messages_cohort_created_idx
  on public.boardroom_chat_messages(cohort, created_at desc);

alter table public.boardroom_chat_messages enable row level security;

revoke all on table public.boardroom_chat_messages from anon;
grant select, insert on table public.boardroom_chat_messages to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_boardroom_chat_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select p.email
    into trusted_email
    from public.profiles as p
   where p.id = (select auth.uid());

  if trusted_email is null then
    raise exception 'profile required';
  end if;

  new.user_id := (select auth.uid());
  new.author_label := split_part(trusted_email, '@', 1);
  new.body := btrim(new.body);
  return new;
end;
$$;

revoke all on function private.set_boardroom_chat_author()
  from public, anon, authenticated;

create trigger boardroom_chat_messages_set_author
  before insert on public.boardroom_chat_messages
  for each row
  execute function private.set_boardroom_chat_author();

create policy "boardroom members read cohort chat"
  on public.boardroom_chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_messages.cohort
    )
  );

create policy "boardroom members post to cohort chat"
  on public.boardroom_chat_messages
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_messages.cohort
    )
  );

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'boardroom_chat_messages'
  ) then
    alter publication supabase_realtime
      add table public.boardroom_chat_messages;
  end if;
end;
$$;
