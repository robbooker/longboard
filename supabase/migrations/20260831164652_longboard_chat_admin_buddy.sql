-- Owner-only Longboard Chat shutdown controls, Buddy replies, and private
-- summaries. Public clients keep read-only access to messages/reactions; every
-- privileged operation remains behind server routes using the service role.

alter table public.longboard_chat_messages
  alter column guest_id drop not null;

alter table public.longboard_chat_messages
  add column bot_slug text,
  add column reply_to_id uuid references public.longboard_chat_messages(id) on delete set null,
  add constraint longboard_chat_messages_actor_check check (
    (guest_id is not null and bot_slug is null)
    or (guest_id is null and bot_slug = 'buddy')
  );

create unique index longboard_chat_messages_buddy_reply_idx
  on public.longboard_chat_messages(reply_to_id)
  where bot_slug = 'buddy' and reply_to_id is not null;

create table public.longboard_chat_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The public shutdown control belongs to Rob's exact authenticated account,
-- not to the broader admin role. The existing profile bootstrap uses this
-- address for Rob and the insert remains a no-op if that account is absent.
insert into public.longboard_chat_owners (user_id)
select id
  from public.profiles
 where lower(email) = 'madspreadsheets@gmail.com'
   and role = 'admin'
on conflict (user_id) do nothing;

create table public.longboard_chat_room_state (
  id smallint primary key default 1 check (id = 1),
  is_open boolean not null default true,
  paused_at timestamptz,
  paused_by uuid references auth.users(id) on delete restrict,
  pause_reason text check (pause_reason is null or char_length(pause_reason) <= 240),
  updated_at timestamptz not null default now(),
  check (
    (is_open and paused_at is null and paused_by is null)
    or (not is_open and paused_at is not null and paused_by is not null)
  )
);

insert into public.longboard_chat_room_state (id, is_open)
values (1, true);

create table public.longboard_chat_admin_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('pause', 'reopen', 'summary_generate')),
  reason text check (reason is null or char_length(reason) <= 240),
  created_at timestamptz not null default now()
);

create index longboard_chat_admin_events_created_idx
  on public.longboard_chat_admin_events(created_at desc);

create table public.longboard_chat_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_date date not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  message_count integer not null check (message_count >= 0),
  model text not null,
  summary_text text not null check (char_length(btrim(summary_text)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start)
);

alter table public.longboard_chat_owners enable row level security;
alter table public.longboard_chat_room_state enable row level security;
alter table public.longboard_chat_admin_events enable row level security;
alter table public.longboard_chat_summaries enable row level security;

revoke all on table public.longboard_chat_owners from anon, authenticated;
revoke all on table public.longboard_chat_room_state from anon, authenticated;
revoke all on table public.longboard_chat_admin_events from anon, authenticated;
revoke all on table public.longboard_chat_summaries from anon, authenticated;

grant select, insert, update, delete on table public.longboard_chat_owners to service_role;
grant select, insert, update, delete on table public.longboard_chat_room_state to service_role;
grant select, insert, update, delete on table public.longboard_chat_admin_events to service_role;
grant select, insert, update, delete on table public.longboard_chat_summaries to service_role;

create function public.enforce_longboard_chat_open()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.longboard_chat_room_state
     where id = 1 and is_open
  ) then
    raise exception 'longboard_chat_paused' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_longboard_chat_open() from public, anon, authenticated;
grant execute on function public.enforce_longboard_chat_open() to service_role;

create trigger longboard_chat_guests_require_open
before insert or update on public.longboard_chat_guests
for each row execute function public.enforce_longboard_chat_open();

create trigger longboard_chat_messages_require_open
before insert or update on public.longboard_chat_messages
for each row execute function public.enforce_longboard_chat_open();

create trigger longboard_chat_reactions_require_open
before insert or update on public.longboard_chat_reactions
for each row execute function public.enforce_longboard_chat_open();
