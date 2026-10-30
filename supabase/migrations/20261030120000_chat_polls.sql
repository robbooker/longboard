-- #328 D-328 Polls: a member asks a question with 2-10 answers in a room or a thread, like Telegram.
--
--  * A poll is a chat message with a linked poll record, so ordering, threads, deletion, search,
--    pins and permissions work as they do for any message. Its body is "📊 Poll: <question>", which
--    is what search, notifications and older app versions show. create_chat_poll sends that
--    message through send_chat_room_message (same pause, member, reply and rate-limit checks, same
--    client_id retry rule) and adds the poll and its answers in the same transaction.
--  * chat_polls: one per message (message_id unique; deleting the message removes the poll).
--    anonymous (default true): nobody, the creator included, can see who voted for what.
--    multi (default false): one answer per person, otherwise any number. closed_at: set once by
--    the creator; a closed poll takes no votes and shows its final results to everyone.
--  * chat_poll_options: 2-10 answers per poll (position 0-9, unique per poll).
--  * chat_poll_votes: one row per member per chosen answer (primary key poll_id+member_id+
--    option_id). A trigger refuses votes on a closed poll and a second answer on a single-answer
--    poll; it takes the same per-poll-per-member lock as vote_chat_poll, so concurrent changes
--    by one person queue instead of racing past the rule.
--  * vote_chat_poll(user, room, message, options[]): replaces the person's answers with exactly
--    these (an empty list takes the vote back). close_chat_poll(user, room, message): creator only.
--  * read_chat_polls(user, room, messages[]): per poll message on the list, its question, answers
--    with counts, the number of people who voted and the reader's own answers. Voter names are
--    read only for polls with visible votes; for anonymous polls no member is ever selected.
--    /api/chat/polls also hides the counts from people who haven't voted on an open poll.
--  * A poll's question can't be edited: a trigger on longboard_chat_messages refuses a body change
--    on a live poll message ('message_forbidden', what change_chat_message callers already map).
--    It only fires when a "📊 Poll: " body changes, so other edits pay nothing. Deleting still works.
--  * Counts are one grouped read through the primary key per batch of polls on screen.
--  * Like the other recent chat tables (#321, #323), RLS is on with no policies and anon/
--    authenticated get nothing; the route uses the service role after requireChatUser and the
--    room access checks. Only the service role may run the functions.
--
-- No existing function is changed.
-- Production when written (2026-10-30): none of these objects exist.
-- Rollback: supabase/rollbacks/20261030120000_chat_polls.down.sql

create table public.chat_polls(
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null unique references public.longboard_chat_messages(id) on delete cascade,
 question text not null check (char_length(question) between 1 and 300 and question = btrim(question)),
 anonymous boolean not null default true,
 multi boolean not null default false,
 created_by uuid not null references public.longboard_chat_members(id) on delete cascade,
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create index chat_polls_created_by on public.chat_polls(created_by);

create table public.chat_poll_options(
 id uuid primary key default gen_random_uuid(),
 poll_id uuid not null references public.chat_polls(id) on delete cascade,
 position smallint not null check (position between 0 and 9),
 label text not null check (char_length(label) between 1 and 100 and label = btrim(label)),
 unique(poll_id, position),
 unique(id, poll_id)
);

create table public.chat_poll_votes(
 poll_id uuid not null,
 option_id uuid not null,
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(poll_id, member_id, option_id),
 foreign key(option_id, poll_id) references public.chat_poll_options(id, poll_id) on delete cascade
);
create index chat_poll_votes_option on public.chat_poll_votes(option_id);
create index chat_poll_votes_member on public.chat_poll_votes(member_id);

-- No votes on a closed poll; one answer per person on a single-answer poll.
create function public.enforce_chat_poll_vote() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 poll public.chat_polls;
begin
 perform pg_advisory_xact_lock(hashtextextended('chat_poll_vote:'||new.poll_id::text||':'||new.member_id::text,0));
 select * into poll from public.chat_polls where id = new.poll_id;
 if not found then raise exception 'poll_not_found' using errcode='23503'; end if;
 if poll.closed_at is not null then raise exception 'poll_closed' using errcode='23514'; end if;
 if not poll.multi and exists(select 1 from public.chat_poll_votes v
   where v.poll_id = new.poll_id and v.member_id = new.member_id and v.option_id <> new.option_id) then
  raise exception 'single_choice' using errcode='23514';
 end if;
 return new;
end $$;
create trigger chat_poll_vote_guard before insert or update on public.chat_poll_votes
 for each row execute function public.enforce_chat_poll_vote();
revoke all on function public.enforce_chat_poll_vote() from public,anon,authenticated;

-- A poll stays as asked: no editing the message's text (deleting it is fine).
create function public.keep_chat_poll_question() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.chat_polls p where p.message_id = new.id) then
  raise exception 'message_forbidden' using errcode='42501';
 end if;
 return new;
end $$;
create trigger chat_poll_question_guard before update of body on public.longboard_chat_messages
 for each row when (old.body like '📊 Poll: %' and new.body is distinct from old.body and new.deleted_at is null)
 execute function public.keep_chat_poll_question();
revoke all on function public.keep_chat_poll_question() from public,anon,authenticated;

-- The poll message and its answers, in one transaction. Returns send_chat_room_message's result.
create function public.create_chat_poll(p_user uuid, p_room text, p_question text, p_options text[],
 p_anonymous boolean, p_multi boolean, p_reply uuid, p_client uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 question text := btrim(coalesce(p_question,''));
 labels text[];
 result jsonb;
 message_id uuid;
 member_id uuid;
 poll_id uuid;
begin
 select array_agg(btrim(o) order by n) into labels from unnest(p_options) with ordinality as t(o,n);
 if char_length(question) not between 1 and 300
  or coalesce(cardinality(labels),0) not between 2 and 10
  or exists(select 1 from unnest(labels) l where l is null or char_length(l) not between 1 and 100)
  or (select count(distinct lower(l)) from unnest(labels) l) <> cardinality(labels)
  or p_anonymous is null or p_multi is null
 then raise exception 'invalid_poll' using errcode='22023'; end if;
 result := public.send_chat_room_message(p_user, p_room, '📊 Poll: '||question, p_reply, '{}'::uuid[], p_client);
 if result->>'status' = 'duplicate' then
  -- A retry of the same send: the poll came with the first one.
  if not exists(select 1 from public.chat_polls p where p.message_id = (result->'message'->>'id')::uuid) then
   return jsonb_build_object('status','send_conflict');
  end if;
  return result;
 end if;
 if result->>'status' <> 'sent' then return result; end if;
 message_id := (result->'message'->>'id')::uuid;
 member_id := (result->'message'->>'member_id')::uuid;
 insert into public.chat_polls(message_id, question, anonymous, multi, created_by)
  values(message_id, question, p_anonymous, p_multi, member_id) returning id into poll_id;
 insert into public.chat_poll_options(poll_id, position, label)
  select poll_id, (n-1)::smallint, l from unnest(labels) with ordinality as t(l,n);
 return result;
end $$;

-- The poll on this (live) message in this room, locked against a concurrent close.
create function public.chat_poll_target(p_room text, p_message uuid) returns public.chat_polls
language sql stable security invoker set search_path='' as $$
 select p.* from public.chat_polls p
  join public.longboard_chat_messages m on m.id = p.message_id
  where p.message_id = p_message and m.room_slug = p_room and m.deleted_at is null and not m.removed
$$;

create function public.vote_chat_poll(p_user uuid, p_room text, p_message uuid, p_options uuid[])
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 member public.longboard_chat_members;
 poll public.chat_polls;
 chosen uuid[] := array(select distinct o from unnest(coalesce(p_options,'{}'::uuid[])) o where o is not null);
begin
 select * into member from public.longboard_chat_members where user_id = p_user;
 if not found then raise exception 'member_required'; end if;
 if not coalesce((select is_open from public.longboard_chat_room_state where room_slug = p_room), false) then
  raise exception 'chat_paused';
 end if;
 select * into poll from public.chat_poll_target(p_room, p_message);
 if poll.id is null then raise exception 'poll_not_found'; end if;
 -- Waits for a close in progress, then sees it.
 perform 1 from public.chat_polls where id = poll.id for share;
 select * into poll from public.chat_polls where id = poll.id;
 if poll.closed_at is not null then raise exception 'poll_closed'; end if;
 if not poll.multi and cardinality(chosen) > 1 then raise exception 'single_choice'; end if;
 if exists(select 1 from unnest(chosen) c where not exists(
   select 1 from public.chat_poll_options o where o.id = c and o.poll_id = poll.id)) then
  raise exception 'invalid_option';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_poll_vote:'||poll.id::text||':'||member.id::text,0));
 delete from public.chat_poll_votes v
  where v.poll_id = poll.id and v.member_id = member.id and not (v.option_id = any(chosen));
 insert into public.chat_poll_votes(poll_id, option_id, member_id)
  select poll.id, c, member.id from unnest(chosen) c
  on conflict do nothing;
 return jsonb_build_object('pollId', poll.id, 'options', to_jsonb(chosen));
end $$;

create function public.close_chat_poll(p_user uuid, p_room text, p_message uuid)
returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 member public.longboard_chat_members;
 poll public.chat_polls;
begin
 select * into member from public.longboard_chat_members where user_id = p_user;
 if not found then raise exception 'member_required'; end if;
 select * into poll from public.chat_poll_target(p_room, p_message);
 if poll.id is null then raise exception 'poll_not_found'; end if;
 if poll.created_by <> member.id then raise exception 'poll_forbidden'; end if;
 update public.chat_polls set closed_at = coalesce(closed_at, now()) where id = poll.id
  returning * into poll;
 return jsonb_build_object('pollId', poll.id, 'closedAt', poll.closed_at);
end $$;

-- Polls on these messages in this room, for one reader. Voter names only for visible-votes polls.
create function public.read_chat_polls(p_user uuid, p_room text, p_messages uuid[])
returns jsonb
language sql stable security invoker set search_path='' as $$
 with me as (select id from public.longboard_chat_members where user_id = p_user),
 polls as (
  select p.* from public.chat_polls p
   join public.longboard_chat_messages m on m.id = p.message_id
   where p.message_id = any(p_messages) and m.room_slug = p_room and m.deleted_at is null and not m.removed
 ),
 tallies as (
  select v.poll_id, v.option_id, count(*)::integer as votes
   from public.chat_poll_votes v where v.poll_id in (select id from polls)
   group by v.poll_id, v.option_id
 ),
 voters as (
  select v.poll_id, count(distinct v.member_id)::integer as voters
   from public.chat_poll_votes v where v.poll_id in (select id from polls)
   group by v.poll_id
 ),
 names as (
  select v.option_id, jsonb_agg(jsonb_build_object('id', mb.id, 'name', mb.display_name)
    order by v.created_at, mb.id) as people
   from polls p
   join public.chat_poll_votes v on v.poll_id = p.id
   join public.longboard_chat_members mb on mb.id = v.member_id
   where not p.anonymous
   group by v.option_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'message_id', p.message_id,
   'question', p.question,
   'anonymous', p.anonymous,
   'multi', p.multi,
   'closed_at', p.closed_at,
   'created_by_me', p.created_by = (select id from me),
   'voters', coalesce((select x.voters from voters x where x.poll_id = p.id), 0),
   'my_votes', coalesce((select jsonb_agg(v.option_id) from public.chat_poll_votes v
     where v.poll_id = p.id and v.member_id = (select id from me)), '[]'::jsonb),
   'options', (select jsonb_agg(jsonb_build_object(
     'id', o.id,
     'label', o.label,
     'votes', coalesce((select t.votes from tallies t where t.option_id = o.id), 0),
     'people', case when p.anonymous then null
       else coalesce((select n.people from names n where n.option_id = o.id), '[]'::jsonb) end
    ) order by o.position) from public.chat_poll_options o where o.poll_id = p.id)
  )), '[]'::jsonb)
 from polls p
$$;

revoke all on function public.create_chat_poll(uuid,text,text,text[],boolean,boolean,uuid,uuid) from public,anon,authenticated;
revoke all on function public.chat_poll_target(text,uuid) from public,anon,authenticated;
revoke all on function public.vote_chat_poll(uuid,text,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.close_chat_poll(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.read_chat_polls(uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.create_chat_poll(uuid,text,text,text[],boolean,boolean,uuid,uuid) to service_role;
grant execute on function public.chat_poll_target(text,uuid) to service_role;
grant execute on function public.vote_chat_poll(uuid,text,uuid,uuid[]) to service_role;
grant execute on function public.close_chat_poll(uuid,text,uuid) to service_role;
grant execute on function public.read_chat_polls(uuid,text,uuid[]) to service_role;

alter table public.chat_polls enable row level security;
alter table public.chat_poll_options enable row level security;
alter table public.chat_poll_votes enable row level security;
revoke all on public.chat_polls, public.chat_poll_options, public.chat_poll_votes from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_polls to service_role;
grant select,insert on public.chat_poll_options to service_role;
grant select,insert,delete on public.chat_poll_votes to service_role;
