-- D-212 (UNREAD-COUNTERS): the bell's numbers as counters, not a query.
--
-- chat_activity_inbox works out the bell on every read: it checks room access, reads every
-- unread mention, DM and reaction for the person, and builds the previews. The bell button only
-- needs the numbers, and those change only when someone mentions, messages, reacts, reads,
-- deletes, blocks or a conversation changes. So this keeps the numbers in a small table, kept
-- up to date by the writes themselves, and the closed bell reads that table instead.
--
--  * chat_activity_counters: one row per person and thing that can be unread, with the unread
--    count and the newest unread number (the cursor the bell already sends back on mark-read):
--      mention       / room slug        unread mentions and reply alerts in that room
--      room_reaction / room slug        unread reactions on the person's messages in that room
--      dm            / conversation id  unread DMs from the other person
--      dm_reaction   / conversation id  unread reactions on the person's DMs
--    Only rows with something unread are kept. The filters that never change on their own
--    (deleted or removed messages, blocks either way, declined conversations, read positions)
--    are applied when a row is worked out. The ones that depend on the reader's current choices
--    (room levels, which rooms they can see) are applied when it is read, as before.
--  * chat_activity_counter_compute: the one definition of what counts, the same filters as
--    chat_activity_inbox (20261019150000_chat_activity_inbox_fast.sql). The backfill, every
--    trigger, the tests and the comparison script all use it.
--  * Triggers on mentions, reaction alerts, room messages (delete/remove), DMs, conversations
--    (reads, status), blocks and member links refresh exactly the rows a write can change. A
--    refresh takes a per-row advisory lock and then recounts with a fresh snapshot, so two
--    writers for the same person and room can never leave a stale count behind.
--  * chat_activity_counts(actor, rooms): the bell's numbers (mentionCount, mentionThrough,
--    roomCounts, roomThrough, dmCount, dmThrough, pinnedDmUnread, reactionCount,
--    reactionThrough, roomLevels, replyNotifications) from those rows: the same keys and values
--    as chat_activity_inbox, without the lists. Primary-key reads only.
--
-- Rooms: chat_activity_inbox checks each requested room again (chat_account_has_room). The
-- counters trust the room list the app passes (the app works it out from the same identity on
-- every request; the lists, which carry message text, still come from chat_activity_inbox with
-- its own checks). DMs keep the inbox rule: Social access when Social is not in the list.
-- scripts/sql/chat-activity-counters-compare.sql compares the two for every account.
--
-- Nothing in the app depends on this until CHAT_BELL_COUNTERS is turned on (see
-- lib/chatReads/activity.ts); with it off the bell keeps using chat_activity_inbox.
-- Locks: creating the triggers briefly blocks writes to the chat tables while the backfill runs
-- (well under a second at today's sizes), so no write can be missed between the two.
-- Rollback: supabase/rollbacks/20261024120000_chat_activity_counters.down.sql

-- Give up (and change nothing) rather than queue chat writes behind a long transaction.
set lock_timeout = '5s';

create table if not exists public.chat_activity_counters (
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 kind text not null check (kind in ('mention','room_reaction','dm','dm_reaction')),
 scope text not null,
 unread integer not null check (unread > 0),
 through_seq bigint not null,
 updated_at timestamptz not null default now(),
 primary key (account_id, kind, scope)
);
alter table public.chat_activity_counters enable row level security;
revoke all on public.chat_activity_counters from public, anon, authenticated;
grant select on public.chat_activity_counters to service_role;

-- A deleted or removed room message refreshes the alerts that point at it.
create index if not exists chat_room_mentions_message on public.chat_room_mentions(message_id);

-- What counts, for one person: every row, or only one kind, or one kind and scope.
-- The same filters as chat_activity_inbox, row for row, minus the read-time ones.
create or replace function public.chat_activity_counter_compute(p_account uuid, p_kind text default null, p_scope text default null)
 returns table(kind text, scope text, unread integer, through_seq bigint)
 language plpgsql
 stable
 security definer
 set search_path to ''
 set plan_cache_mode to 'force_generic_plan'
as $function$
begin
 return query
 with me as (select m.id from public.longboard_chat_members m where m.user_id=p_account),
 blocked as materialized (
  select coalesce(array_agg(case when b.blocker_id=me.id then b.blocked_id else b.blocker_id end),'{}'::uuid[]) ids
  from public.longboard_chat_blocks b join me on b.blocker_id=me.id or b.blocked_id=me.id
 )
 select 'mention'::text, n.room_slug, count(*)::integer, max(n.seq)
 from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
 left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
 where (p_kind is null or p_kind='mention') and n.account_id=p_account and n.read_at is null
  and (p_scope is null or n.room_slug=p_scope)
  and m.deleted_at is null and not m.removed
  and not coalesce(m.member_id=any((select ids from blocked)::uuid[]),false)
  and not coalesce(parent.member_id=any((select ids from blocked)::uuid[]),false)
 group by n.room_slug
 union all
 select 'room_reaction'::text, m.room_slug, count(*)::integer, max(n.seq)
 from public.chat_reaction_notifications n join me on true
 join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
 join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
 where (p_kind is null or p_kind='room_reaction') and n.account_id=p_account and n.room_message_id is not null
  and n.read_at is null and m.deleted_at is null and not m.removed
  and (p_scope is null or m.room_slug=p_scope)
  and reactor.id<>all((select ids from blocked)::uuid[])
 group by m.room_slug
 union all
 select 'dm_reaction'::text, c.id::text, count(*)::integer, max(n.seq)
 from public.chat_reaction_notifications n join me on true
 join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
 join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
 join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
 where (p_kind is null or p_kind='dm_reaction') and n.account_id=p_account and n.dm_message_id is not null
  and n.read_at is null and m.deleted_at is null and c.status='accepted'
  and (p_scope is null or c.id::text=p_scope)
  and reactor.id<>all((select ids from blocked)::uuid[])
 group by c.id
 union all
 select 'dm'::text, c.id::text, d.unread::integer, d.through_seq
 from me join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
 join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
 cross join lateral (
  select count(*) unread, max(d.seq) through_seq from public.longboard_chat_direct_messages d
  where d.conversation_id=c.id and d.sender_id<>me.id and d.deleted_at is null
   and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end
 ) d
 where (p_kind is null or p_kind='dm') and (p_scope is null or c.id::text=p_scope)
  and c.status<>'declined' and other.id<>all((select ids from blocked)::uuid[]) and d.unread>0;
end
$function$;

-- Recount one row. The advisory lock makes a second writer for the same row wait until the
-- first commits; the recount after it is a new statement, so it sees that commit.
create or replace function public.chat_activity_counter_refresh(p_account uuid, p_kind text, p_scope text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_unread integer; v_through bigint;
begin
 if p_account is null or p_kind is null or p_scope is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_activity_counter:'||p_account::text||':'||p_kind||':'||p_scope,0));
 select c.unread,c.through_seq into v_unread,v_through from public.chat_activity_counter_compute(p_account,p_kind,p_scope) c;
 if coalesce(v_unread,0)>0 then
  insert into public.chat_activity_counters as t(account_id,kind,scope,unread,through_seq,updated_at)
  values(p_account,p_kind,p_scope,v_unread,v_through,now())
  on conflict(account_id,kind,scope) do update set unread=excluded.unread,through_seq=excluded.through_seq,updated_at=excluded.updated_at
  where (t.unread,t.through_seq) is distinct from (excluded.unread,excluded.through_seq);
 else
  delete from public.chat_activity_counters t where t.account_id=p_account and t.kind=p_kind and t.scope=p_scope;
 end if;
end
$function$;

-- Recount every row of one kind (or every kind) for a person: blocks, member links, and alerts
-- whose message is already gone (so their room or conversation can no longer be looked up).
create or replace function public.chat_activity_counter_refresh_account(p_account uuid, p_kind text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 if p_account is null then return; end if;
 for r in
  select c.kind,c.scope from public.chat_activity_counter_compute(p_account,p_kind) c
  union
  select t.kind,t.scope from public.chat_activity_counters t where t.account_id=p_account and (p_kind is null or t.kind=p_kind)
  order by 1,2
 loop
  perform public.chat_activity_counter_refresh(p_account,r.kind,r.scope);
 end loop;
end
$function$;

-- Mentions: inserted (new message), read, re-pointed or deleted (edit, cascade).
create or replace function public.chat_activity_counters_mentions()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 if tg_op='INSERT' then
  for r in select distinct account_id,room_slug from new_rows order by 1,2 loop
   perform public.chat_activity_counter_refresh(r.account_id,'mention',r.room_slug);
  end loop;
 elsif tg_op='DELETE' then
  for r in select distinct account_id,room_slug from old_rows order by 1,2 loop
   perform public.chat_activity_counter_refresh(r.account_id,'mention',r.room_slug);
  end loop;
 else
  for r in select account_id,room_slug from new_rows union select account_id,room_slug from old_rows order by 1,2 loop
   perform public.chat_activity_counter_refresh(r.account_id,'mention',r.room_slug);
  end loop;
 end if;
 return null;
end
$function$;

-- Reaction alerts: the row's room or conversation comes from its message; when the message is
-- already gone (a cascade), every row of that kind is recounted for the person.
create or replace function public.chat_activity_counters_reactions()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record; v_accounts uuid[]; v_rooms uuid[]; v_dms uuid[];
begin
 -- A transition table exists only for the events that have it, so read each in its own branch.
 if tg_op in ('INSERT','UPDATE') then
  select array_agg(account_id),array_agg(room_message_id),array_agg(dm_message_id) into v_accounts,v_rooms,v_dms from new_rows;
 end if;
 if tg_op in ('UPDATE','DELETE') then
  select coalesce(v_accounts,'{}')||array_agg(account_id),coalesce(v_rooms,'{}')||array_agg(room_message_id),coalesce(v_dms,'{}')||array_agg(dm_message_id)
  into v_accounts,v_rooms,v_dms from old_rows;
 end if;
 for r in
  select distinct ch.account_id,
   case when ch.room_message_id is not null then 'room_reaction' else 'dm_reaction' end kind,
   coalesce(m.room_slug,d.conversation_id::text) scope
  from unnest(v_accounts,v_rooms,v_dms) ch(account_id,room_message_id,dm_message_id)
  left join public.longboard_chat_messages m on m.id=ch.room_message_id
  left join public.longboard_chat_direct_messages d on d.id=ch.dm_message_id
  where ch.account_id is not null
  order by 1,2,3
 loop
  if r.scope is null then perform public.chat_activity_counter_refresh_account(r.account_id,r.kind);
  else perform public.chat_activity_counter_refresh(r.account_id,r.kind,r.scope);
  end if;
 end loop;
 return null;
end
$function$;

-- Room messages: a delete, remove (or undo), a new author or a move changes what counts for the
-- alerts that point at the message. Hard deletes cascade to the alerts themselves.
create or replace function public.chat_activity_counters_room_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 for r in
  select n.account_id,'mention'::text kind,n.room_slug scope from public.chat_room_mentions n where n.message_id=new.id
  union
  select n.account_id,'mention',n.room_slug from public.chat_room_mentions n
   where n.thread_root_id=new.id and old.member_id is distinct from new.member_id
  union
  select n.account_id,'room_reaction',s.slug from public.chat_reaction_notifications n
   cross join (values (old.room_slug),(new.room_slug)) s(slug)
   where n.room_message_id=new.id
  order by 1,2,3
 loop
  perform public.chat_activity_counter_refresh(r.account_id,r.kind,r.scope);
 end loop;
 return null;
end
$function$;

-- One conversation, both people: DMs (and, when asked, reactions on DMs).
create or replace function public.chat_activity_counter_refresh_conversation(p_conversation uuid, p_reactions boolean)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 for r in
  select m.user_id account_id from public.longboard_chat_conversations c
  join public.longboard_chat_members m on m.id in (c.requester_id,c.recipient_id)
  where c.id=p_conversation and m.user_id is not null
  order by 1
 loop
  perform public.chat_activity_counter_refresh(r.account_id,'dm',p_conversation::text);
  if p_reactions then perform public.chat_activity_counter_refresh(r.account_id,'dm_reaction',p_conversation::text); end if;
 end loop;
end
$function$;

create or replace function public.chat_activity_counters_direct_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
 if tg_op in ('UPDATE','DELETE') then
  perform public.chat_activity_counter_refresh_conversation(old.conversation_id,tg_op='DELETE' or old.deleted_at is distinct from new.deleted_at);
 end if;
 if tg_op='INSERT' or (tg_op='UPDATE' and old.conversation_id is distinct from new.conversation_id) then
  perform public.chat_activity_counter_refresh_conversation(new.conversation_id,tg_op='UPDATE');
 end if;
 return null;
end
$function$;

create or replace function public.chat_activity_counters_conversation()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 if tg_op='DELETE' then
  -- Its DMs are gone by now (cascade), so drop its rows directly.
  delete from public.chat_activity_counters t where t.kind in ('dm','dm_reaction') and t.scope=old.id::text;
  return null;
 end if;
 if old.requester_id is distinct from new.requester_id or old.recipient_id is distinct from new.recipient_id then
  for r in select m.user_id from public.longboard_chat_members m where m.id in (old.requester_id,old.recipient_id,new.requester_id,new.recipient_id) and m.user_id is not null order by 1 loop
   perform public.chat_activity_counter_refresh(r.user_id,'dm',new.id::text);
   perform public.chat_activity_counter_refresh(r.user_id,'dm_reaction',new.id::text);
  end loop;
 else
  perform public.chat_activity_counter_refresh_conversation(new.id,old.status is distinct from new.status);
 end if;
 return null;
end
$function$;

-- Blocks (either way) hide mentions, reactions and DMs from that person: recount both people.
create or replace function public.chat_activity_counters_block()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record; v_blocker uuid; v_blocked uuid;
begin
 if tg_op='DELETE' then v_blocker:=old.blocker_id; v_blocked:=old.blocked_id;
 else v_blocker:=new.blocker_id; v_blocked:=new.blocked_id; end if;
 for r in select m.user_id from public.longboard_chat_members m where m.id in (v_blocker,v_blocked) and m.user_id is not null order by 1 loop
  perform public.chat_activity_counter_refresh_account(r.user_id);
 end loop;
 return null;
end
$function$;

-- A member linked to an account (or moved to another one): recount both accounts.
create or replace function public.chat_activity_counters_member()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
 for r in
  select a from (values (case when tg_op='UPDATE' then old.user_id end),(new.user_id)) v(a) where a is not null
  order by 1
 loop
  perform public.chat_activity_counter_refresh_account(r.a);
 end loop;
 return null;
end
$function$;

revoke all on function public.chat_activity_counter_compute(uuid,text,text), public.chat_activity_counter_refresh(uuid,text,text),
 public.chat_activity_counter_refresh_account(uuid,text), public.chat_activity_counter_refresh_conversation(uuid,boolean),
 public.chat_activity_counters_mentions(), public.chat_activity_counters_reactions(), public.chat_activity_counters_room_message(),
 public.chat_activity_counters_direct_message(), public.chat_activity_counters_conversation(), public.chat_activity_counters_block(),
 public.chat_activity_counters_member() from public, anon, authenticated;
grant execute on function public.chat_activity_counter_compute(uuid,text,text) to service_role;

drop trigger if exists chat_activity_counters_insert on public.chat_room_mentions;
drop trigger if exists chat_activity_counters_update on public.chat_room_mentions;
drop trigger if exists chat_activity_counters_delete on public.chat_room_mentions;
create trigger chat_activity_counters_insert after insert on public.chat_room_mentions
 referencing new table as new_rows for each statement execute function public.chat_activity_counters_mentions();
create trigger chat_activity_counters_update after update on public.chat_room_mentions
 referencing old table as old_rows new table as new_rows for each statement execute function public.chat_activity_counters_mentions();
create trigger chat_activity_counters_delete after delete on public.chat_room_mentions
 referencing old table as old_rows for each statement execute function public.chat_activity_counters_mentions();

drop trigger if exists chat_activity_counters_insert on public.chat_reaction_notifications;
drop trigger if exists chat_activity_counters_update on public.chat_reaction_notifications;
drop trigger if exists chat_activity_counters_delete on public.chat_reaction_notifications;
create trigger chat_activity_counters_insert after insert on public.chat_reaction_notifications
 referencing new table as new_rows for each statement execute function public.chat_activity_counters_reactions();
create trigger chat_activity_counters_update after update on public.chat_reaction_notifications
 referencing old table as old_rows new table as new_rows for each statement execute function public.chat_activity_counters_reactions();
create trigger chat_activity_counters_delete after delete on public.chat_reaction_notifications
 referencing old table as old_rows for each statement execute function public.chat_activity_counters_reactions();

drop trigger if exists chat_activity_counters on public.longboard_chat_messages;
create trigger chat_activity_counters after update of deleted_at, removed, member_id, room_slug on public.longboard_chat_messages
 for each row when (old.deleted_at is distinct from new.deleted_at or old.removed is distinct from new.removed
  or old.member_id is distinct from new.member_id or old.room_slug is distinct from new.room_slug)
 execute function public.chat_activity_counters_room_message();

drop trigger if exists chat_activity_counters on public.longboard_chat_direct_messages;
drop trigger if exists chat_activity_counters_update on public.longboard_chat_direct_messages;
create trigger chat_activity_counters after insert or delete on public.longboard_chat_direct_messages
 for each row execute function public.chat_activity_counters_direct_message();
create trigger chat_activity_counters_update after update of deleted_at, sender_id, conversation_id on public.longboard_chat_direct_messages
 for each row when (old.deleted_at is distinct from new.deleted_at or old.sender_id is distinct from new.sender_id
  or old.conversation_id is distinct from new.conversation_id)
 execute function public.chat_activity_counters_direct_message();

drop trigger if exists chat_activity_counters on public.longboard_chat_conversations;
drop trigger if exists chat_activity_counters_delete on public.longboard_chat_conversations;
create trigger chat_activity_counters after update of status, requester_read_seq, recipient_read_seq, requester_id, recipient_id on public.longboard_chat_conversations
 for each row when (old.status is distinct from new.status or old.requester_read_seq is distinct from new.requester_read_seq
  or old.recipient_read_seq is distinct from new.recipient_read_seq or old.requester_id is distinct from new.requester_id
  or old.recipient_id is distinct from new.recipient_id)
 execute function public.chat_activity_counters_conversation();
create trigger chat_activity_counters_delete after delete on public.longboard_chat_conversations
 for each row execute function public.chat_activity_counters_conversation();

drop trigger if exists chat_activity_counters on public.longboard_chat_blocks;
create trigger chat_activity_counters after insert or delete on public.longboard_chat_blocks
 for each row execute function public.chat_activity_counters_block();

drop trigger if exists chat_activity_counters on public.longboard_chat_members;
drop trigger if exists chat_activity_counters_update on public.longboard_chat_members;
create trigger chat_activity_counters after insert on public.longboard_chat_members
 for each row execute function public.chat_activity_counters_member();
create trigger chat_activity_counters_update after update of user_id on public.longboard_chat_members
 for each row when (old.user_id is distinct from new.user_id) execute function public.chat_activity_counters_member();

-- Backfill: every account, from the same definition. Applied as one file (one transaction), the
-- triggers above already hold the locks that keep writers out until this commits; the upsert
-- keeps a re-run safe too.
delete from public.chat_activity_counters t
where not exists (select 1 from public.chat_activity_counter_compute(t.account_id) c where (c.kind,c.scope)=(t.kind,t.scope));
insert into public.chat_activity_counters as t(account_id,kind,scope,unread,through_seq)
select a.id,c.kind,c.scope,c.unread,c.through_seq
from public.chat_accounts a cross join lateral public.chat_activity_counter_compute(a.id) c
on conflict(account_id,kind,scope) do update set unread=excluded.unread,through_seq=excluded.through_seq,updated_at=now();

-- The bell's numbers for one person and room list: the count keys of chat_activity_inbox.
create or replace function public.chat_activity_counts(actor uuid, rooms text[])
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
 set plan_cache_mode to 'force_generic_plan'
as $function$
begin
 return (
 with access as materialized (
  -- DMs need Social. Social in the list was checked by the app; without it, the inbox's own check.
  select case when 'social'=any(rooms) then true else public.chat_account_has_room(actor,'social') end social_ok
 ),
 levels as materialized (
  select coalesce(jsonb_object_agg(p.room_slug,p.level),'{}'::jsonb) room_levels,
   coalesce(array_agg(p.room_slug) filter (where p.level='muted' or (p.level='mentions' and p.room_slug in ('lb-announcements','ss-announcements','lb-recordings','ss-recordings'))),'{}'::text[]) quiet_mentions,
   coalesce(array_agg(p.room_slug) filter (where p.level in ('muted','mentions')),'{}'::text[]) quiet_reactions
  from public.chat_room_notification_levels p where p.account_id=actor and p.room_slug=any(rooms)
 ),
 counters as materialized (select t.kind,t.scope,t.unread,t.through_seq from public.chat_activity_counters t where t.account_id=actor),
 mentions as (
  select c.scope room,c.unread,c.through_seq from counters c
  where c.kind='mention' and c.scope=any(rooms) and c.scope<>all((select quiet_mentions from levels)::text[])
 ),
 reactions as (
  select c.unread,c.through_seq from counters c
  where (c.kind='room_reaction' and c.scope=any(rooms) and c.scope<>all((select quiet_reactions from levels)::text[]))
   or (c.kind='dm_reaction' and (select social_ok from access))
 ),
 dms as (select c.scope,c.unread,c.through_seq from counters c where c.kind='dm' and (select social_ok from access)),
 me as (select id from public.longboard_chat_members where user_id=actor),
 pinned as (
  -- Same rule as the inbox: accepted, not blocked either way, recipient still eligible for Social.
  select p.conversation_id id,coalesce(d.unread,0) unread
  from public.chat_conversation_pins p join me on true
  join public.longboard_chat_conversations c on c.id=p.conversation_id and c.status='accepted' and me.id in (c.requester_id,c.recipient_id)
  join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
  left join dms d on d.scope=c.id::text
  where p.account_id=actor and (select social_ok from access)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id))
   and public.chat_account_room_recipient_eligible(other.user_id,'social')
  order by p.id limit 50
 )
 select jsonb_build_object(
  'roomLevels',(select room_levels from levels),
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentionCount',coalesce((select sum(unread) from mentions),0),'mentionThrough',coalesce((select max(through_seq) from mentions),0),
  'roomCounts',coalesce((select jsonb_object_agg(room,unread) from mentions),'{}'::jsonb),
  'roomThrough',coalesce((select jsonb_object_agg(room,through_seq) from mentions),'{}'::jsonb),
  'pinnedDmUnread',coalesce((select jsonb_object_agg(id,unread) from pinned),'{}'::jsonb),
  'dmCount',coalesce((select sum(unread) from dms),0),'dmThrough',coalesce((select max(through_seq) from dms),0),
  'reactionCount',coalesce((select sum(unread) from reactions),0),'reactionThrough',coalesce((select max(through_seq) from reactions),0)
 )
 );
end
$function$;
revoke all on function public.chat_activity_counts(uuid,text[]) from public, anon, authenticated;
grant execute on function public.chat_activity_counts(uuid,text[]) to service_role;
