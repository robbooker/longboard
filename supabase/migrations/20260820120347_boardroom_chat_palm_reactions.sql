-- Cohort-private palm-tree likes for Boardroom Chat.
--
-- A member owns one durable reaction row per message. Toggling the palm updates
-- `active` instead of deleting the row so Realtime can authorize and deliver
-- both sides of the toggle through normal RLS-protected UPDATE events.

create table public.boardroom_chat_reactions (
  message_id uuid not null references public.boardroom_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cohort text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index boardroom_chat_reactions_cohort_message_idx
  on public.boardroom_chat_reactions(cohort, message_id);

create index boardroom_chat_reactions_user_idx
  on public.boardroom_chat_reactions(user_id, updated_at desc);

alter table public.boardroom_chat_reactions enable row level security;

revoke all on table public.boardroom_chat_reactions from anon, authenticated;
grant select, insert on table public.boardroom_chat_reactions to authenticated;
grant update (active) on table public.boardroom_chat_reactions to authenticated;

create policy "boardroom members read cohort reactions"
  on public.boardroom_chat_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_reactions.cohort
    )
  );

create policy "boardroom members add their own reactions"
  on public.boardroom_chat_reactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_reactions.cohort
    )
    and exists (
      select 1
        from public.boardroom_chat_messages
       where boardroom_chat_messages.id = boardroom_chat_reactions.message_id
         and boardroom_chat_messages.cohort = boardroom_chat_reactions.cohort
    )
  );

create policy "boardroom members update their own reactions"
  on public.boardroom_chat_reactions
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_reactions.cohort
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_reactions.cohort
    )
    and exists (
      select 1
        from public.boardroom_chat_messages
       where boardroom_chat_messages.id = boardroom_chat_reactions.message_id
         and boardroom_chat_messages.cohort = boardroom_chat_reactions.cohort
    )
  );

create or replace function private.set_boardroom_chat_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_user_id uuid;
  trusted_cohort text;
begin
  trusted_user_id := (select auth.uid());
  if trusted_user_id is null then
    raise exception 'authentication required';
  end if;

  if tg_op = 'UPDATE' and new.message_id is distinct from old.message_id then
    raise exception 'reaction message cannot change';
  end if;

  select messages.cohort
    into trusted_cohort
    from public.boardroom_chat_messages as messages
   where messages.id = new.message_id;

  if trusted_cohort is null then
    raise exception 'boardroom message required';
  end if;

  if not exists (
    select 1
      from public.user_tags
     where user_tags.user_id = trusted_user_id
       and user_tags.tag = 'boardroom-' || trusted_cohort
  ) then
    raise exception 'boardroom membership required';
  end if;

  new.user_id := trusted_user_id;
  new.cohort := trusted_cohort;
  new.active := coalesce(new.active, true);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_boardroom_chat_reaction()
  from public, anon, authenticated;

create trigger boardroom_chat_reactions_set_owner
  before insert or update on public.boardroom_chat_reactions
  for each row
  execute function private.set_boardroom_chat_reaction();

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'boardroom_chat_reactions'
  ) then
    alter publication supabase_realtime
      add table public.boardroom_chat_reactions;
  end if;
end;
$$;
