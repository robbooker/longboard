-- Public Longboard chat with server-owned guest identities and palm reactions.
--
-- Visitors read messages and reactions through the Data API and Realtime. All
-- writes go through /api/chat after it proves ownership of an unguessable guest
-- token. Only a SHA-256 digest of that token is stored in Postgres.

create table public.longboard_chat_guests (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  display_name text not null check (
    char_length(btrim(display_name)) between 2 and 28
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.longboard_chat_messages (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.longboard_chat_guests(id) on delete cascade,
  author_label text not null check (
    char_length(btrim(author_label)) between 2 and 28
  ),
  body text not null check (
    char_length(btrim(body)) between 1 and 600
  ),
  created_at timestamptz not null default now()
);

create index longboard_chat_messages_created_idx
  on public.longboard_chat_messages(created_at desc);

create index longboard_chat_messages_guest_created_idx
  on public.longboard_chat_messages(guest_id, created_at desc);

create table public.longboard_chat_reactions (
  message_id uuid not null references public.longboard_chat_messages(id) on delete cascade,
  guest_id uuid not null references public.longboard_chat_guests(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, guest_id)
);

create index longboard_chat_reactions_message_idx
  on public.longboard_chat_reactions(message_id)
  where active;

alter table public.longboard_chat_guests enable row level security;
alter table public.longboard_chat_messages enable row level security;
alter table public.longboard_chat_reactions enable row level security;

revoke all on table public.longboard_chat_guests from anon, authenticated;
revoke all on table public.longboard_chat_messages from anon, authenticated;
revoke all on table public.longboard_chat_reactions from anon, authenticated;

grant select on table public.longboard_chat_messages to anon, authenticated;
grant select on table public.longboard_chat_reactions to anon, authenticated;

create policy "public reads Longboard chat messages"
  on public.longboard_chat_messages
  for select
  to anon, authenticated
  using (true);

create policy "public reads Longboard chat reactions"
  on public.longboard_chat_reactions
  for select
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'longboard_chat_messages'
  ) then
    alter publication supabase_realtime
      add table public.longboard_chat_messages;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'longboard_chat_reactions'
  ) then
    alter publication supabase_realtime
      add table public.longboard_chat_reactions;
  end if;
end;
$$;
