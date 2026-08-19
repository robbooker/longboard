-- Cohort-private Boardroom handles and durable @mentions.
--
-- Clients can read only participant handles in cohorts they belong to. Message
-- authors and mention recipients are resolved by locked database triggers, so
-- a browser cannot impersonate another member or manufacture notifications.

create table public.boardroom_chat_participants (
  cohort text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text not null check (
    handle = lower(handle)
    and handle ~ '^[a-z0-9_]{2,32}$'
  ),
  created_at timestamptz not null default now(),
  primary key (cohort, user_id),
  unique (cohort, handle)
);

create index boardroom_chat_participants_user_idx
  on public.boardroom_chat_participants(user_id, cohort);

alter table public.boardroom_chat_participants enable row level security;

revoke all on table public.boardroom_chat_participants from anon, authenticated;
grant select on table public.boardroom_chat_participants to authenticated;

create policy "boardroom members read cohort participants"
  on public.boardroom_chat_participants
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_participants.cohort
    )
  );

create or replace function private.boardroom_chat_handle(
  source_email text,
  source_user_id uuid
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text;
begin
  candidate := lower(split_part(coalesce(source_email, ''), '@', 1));
  candidate := regexp_replace(candidate, '[^a-z0-9_]+', '_', 'g');
  candidate := trim(both '_' from candidate);

  if char_length(candidate) < 2 then
    candidate := 'member_' || left(replace(source_user_id::text, '-', ''), 8);
  end if;

  candidate := left(candidate, 32);

  if candidate in ('pedrobot', 'all', 'everyone', 'here') then
    candidate := left(candidate, 25) || '_' || left(replace(source_user_id::text, '-', ''), 6);
  end if;

  return candidate;
end;
$$;

revoke all on function private.boardroom_chat_handle(text, uuid)
  from public, anon, authenticated;

create or replace function private.sync_boardroom_chat_participant(
  target_user_id uuid,
  target_cohort text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_email text;
  candidate text;
begin
  if target_cohort is null or target_cohort = '' then
    return;
  end if;

  select profiles.email
    into trusted_email
    from public.profiles
   where profiles.id = target_user_id;

  if trusted_email is null then
    return;
  end if;

  candidate := private.boardroom_chat_handle(trusted_email, target_user_id);

  if exists (
    select 1
      from public.boardroom_chat_participants
     where cohort = target_cohort
       and handle = candidate
       and user_id <> target_user_id
  ) then
    candidate := left(candidate, 25) || '_' || left(replace(target_user_id::text, '-', ''), 6);
  end if;

  insert into public.boardroom_chat_participants (cohort, user_id, handle)
  values (target_cohort, target_user_id, candidate)
  on conflict (cohort, user_id) do nothing;
end;
$$;

revoke all on function private.sync_boardroom_chat_participant(uuid, text)
  from public, anon, authenticated;

create or replace function private.sync_boardroom_chat_participant_from_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'UPDATE')
     and old.tag like 'boardroom-cohort-%'
     and (tg_op = 'DELETE' or old.user_id is distinct from new.user_id or old.tag is distinct from new.tag) then
    delete from public.boardroom_chat_participants
     where user_id = old.user_id
       and cohort = substring(old.tag from char_length('boardroom-') + 1);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.tag like 'boardroom-cohort-%' then
    perform private.sync_boardroom_chat_participant(
      new.user_id,
      substring(new.tag from char_length('boardroom-') + 1)
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.sync_boardroom_chat_participant_from_tag()
  from public, anon, authenticated;

create trigger user_tags_sync_boardroom_chat_participant
  after insert or update or delete on public.user_tags
  for each row
  execute function private.sync_boardroom_chat_participant_from_tag();

do $$
declare
  membership record;
begin
  for membership in
    select user_id, substring(tag from char_length('boardroom-') + 1) as cohort
      from public.user_tags
     where tag like 'boardroom-cohort-%'
  loop
    perform private.sync_boardroom_chat_participant(membership.user_id, membership.cohort);
  end loop;
end;
$$;

create table public.boardroom_chat_mentions (
  message_id uuid not null references public.boardroom_chat_messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  cohort text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, mentioned_user_id)
);

create index boardroom_chat_mentions_recipient_idx
  on public.boardroom_chat_mentions(mentioned_user_id, cohort, read_at, created_at desc);

alter table public.boardroom_chat_mentions enable row level security;

revoke all on table public.boardroom_chat_mentions from anon, authenticated;
grant select on table public.boardroom_chat_mentions to authenticated;
grant update (read_at) on table public.boardroom_chat_mentions to authenticated;

create policy "members read their own chat mentions"
  on public.boardroom_chat_mentions
  for select
  to authenticated
  using (
    mentioned_user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_mentions.cohort
    )
  );

create policy "members mark their own chat mentions read"
  on public.boardroom_chat_mentions
  for update
  to authenticated
  using (
    mentioned_user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_mentions.cohort
    )
  )
  with check (
    mentioned_user_id = (select auth.uid())
    and exists (
      select 1
        from public.user_tags
       where user_tags.user_id = (select auth.uid())
         and user_tags.tag = 'boardroom-' || boardroom_chat_mentions.cohort
    )
  );

create or replace function private.capture_boardroom_chat_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bot_slug is not null then
    return new;
  end if;

  insert into public.boardroom_chat_mentions (
    message_id,
    mentioned_user_id,
    cohort,
    created_at
  )
  select distinct
    new.id,
    participants.user_id,
    new.cohort,
    new.created_at
  from regexp_matches(
    new.body,
    '(^|[[:space:]])@([a-zA-Z0-9_]{2,32})',
    'g'
  ) as matches(parts)
  join public.boardroom_chat_participants as participants
    on participants.cohort = new.cohort
   and participants.handle = lower(matches.parts[2])
  where participants.user_id <> new.user_id
  on conflict (message_id, mentioned_user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.capture_boardroom_chat_mentions()
  from public, anon, authenticated;

create trigger boardroom_chat_messages_capture_mentions
  after insert on public.boardroom_chat_messages
  for each row
  execute function private.capture_boardroom_chat_mentions();

create or replace function private.set_boardroom_chat_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_handle text;
  source_message public.boardroom_chat_messages%rowtype;
begin
  if (select auth.uid()) is null then
    if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
       or new.bot_slug <> 'pedrobot'
       or new.reply_to_id is null then
      raise exception 'authentication required';
    end if;

    select *
      into source_message
      from public.boardroom_chat_messages
     where id = new.reply_to_id
       and bot_slug is null;

    if source_message.id is null then
      raise exception 'source message required';
    end if;

    new.cohort := source_message.cohort;
    new.user_id := source_message.user_id;
    new.author_label := '@pedrobot';
    new.bot_slug := 'pedrobot';
    new.body := btrim(new.body);
    return new;
  end if;

  select participants.handle
    into trusted_handle
    from public.boardroom_chat_participants as participants
   where participants.user_id = (select auth.uid())
     and participants.cohort = new.cohort;

  if trusted_handle is null then
    raise exception 'boardroom participant required';
  end if;

  new.user_id := (select auth.uid());
  new.author_label := trusted_handle;
  new.bot_slug := null;
  new.reply_to_id := null;
  new.body := btrim(new.body);
  return new;
end;
$$;

update public.boardroom_chat_messages as messages
   set author_label = participants.handle
  from public.boardroom_chat_participants as participants
 where messages.bot_slug is null
   and messages.cohort = participants.cohort
   and messages.user_id = participants.user_id
   and messages.author_label is distinct from participants.handle;

insert into public.boardroom_chat_mentions (
  message_id,
  mentioned_user_id,
  cohort,
  created_at
)
select distinct
  messages.id,
  participants.user_id,
  messages.cohort,
  messages.created_at
from public.boardroom_chat_messages as messages
cross join lateral regexp_matches(
  messages.body,
  '(^|[[:space:]])@([a-zA-Z0-9_]{2,32})',
  'g'
) as matches(parts)
join public.boardroom_chat_participants as participants
  on participants.cohort = messages.cohort
 and participants.handle = lower(matches.parts[2])
where messages.bot_slug is null
  and participants.user_id <> messages.user_id
on conflict (message_id, mentioned_user_id) do nothing;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'boardroom_chat_mentions'
  ) then
    alter publication supabase_realtime
      add table public.boardroom_chat_mentions;
  end if;
end;
$$;
