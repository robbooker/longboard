-- #332 LB-FAQ: a FAQ page in the chat sidebar, directly under What's New, and a private Admins room
-- that receives "Suggest a topic" notes (Rob's decision: a room, not group DMs or an on-page list).
--
-- FAQ
--  * chat_faq_items: one question and answer per row, in page order (position, then created_at).
--    Answers are plain text with line breaks. Any chat member reads them; only admins add, edit or
--    remove them (/api/chat/faq). Two starter items are seeded at the end of this file.
--
-- Admins room
--  * Room slug 'admins' (room_state id 11). A regular conversation room (posts, replies, reactions,
--    tags, files, pins, search, /summary) that only admins can see, read or post in.
--    chat_account_has_room and chat_account_room_recipient_eligible check it first: an admin, and
--    never a bot, even one with 'admins' in its allowed_rooms. Everything built on them follows
--    (member lists and counts, mentions, the bell, DM directory, polls). Non-admin rooms keep their rules.
--  * The read policy on longboard_chat_messages lists 'admins' only in its admin branch.
--  * Each function below is the current definition with only 'admins' added to its room list.
--
-- Suggestions
--  * post_chat_faq_suggestion(member, topic): called by /api/chat/faq/suggestions with the service
--    role, for the verified member. Posts one message to 'admins' from bot 'faq-suggestions'
--    (labelled "FAQ Suggestions"), naming the member (read from the members table, never from the
--    caller). The actor check allows that bot in that room only. A bot post has no member, so it
--    raises no mentions or push; admins see the room's unread count.
--  * chat_faq_suggestions: who suggested what, which is also the rate limit, checked under a
--    per-member lock: 1 a minute and 5 a day. Service role only. Suggestions are never FAQ items.
--
-- Existing functions changed (exact previous bodies are in the rollback):
--   chat_account_has_room, chat_account_room_recipient_eligible, longboard_chat_room_member_count, longboard_chat_room_members, longboard_chat_room_members_ordered, longboard_chat_room_member_names, queue_chat_push, queue_longboard_chat_embedding, claim_longboard_chat_embeddings, search_longboard_chat, search_longboard_chat_semantic.
-- Existing constraints changed: the ten room_slug checks the Developers room changed, and
--   longboard_chat_messages_actor_check. Existing policy changed: "members read chat messages".
--
-- Production when written (2026-10-30): none of this exists; 10 rooms in room_state (ids 1-10).
-- Function bodies match the latest definition of each in supabase/migrations.
-- Without this migration the app still runs: the FAQ page says it isn't available, a suggestion
-- fails with a clear message, and an admin opening the Admins row sees "Chat temporarily unavailable"
-- (every other room, the bell and search keep working; checked by running the code without it).
-- Needs #330 (20261030200000_chat_bot_accounts.sql) first.
-- Rollback: supabase/rollbacks/20261030220000_chat_faq.down.sql

create table public.chat_faq_items(
 id uuid primary key default gen_random_uuid(),
 question text not null check(char_length(btrim(question)) between 1 and 200 and question !~ '[\r\n]'),
 answer text not null check(char_length(btrim(answer)) between 1 and 5000),
 position integer not null default 100,
 created_by uuid references public.longboard_chat_members(id) on delete set null,
 updated_by uuid references public.longboard_chat_members(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index chat_faq_items_order on public.chat_faq_items(position, created_at);

create table public.chat_faq_suggestions(
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null,
 topic text not null check(char_length(btrim(topic)) between 1 and 300 and topic !~ '[\r\n]'),
 suggested_by uuid references public.longboard_chat_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index chat_faq_suggestions_member on public.chat_faq_suggestions(suggested_by,created_at desc) where suggested_by is not null;

alter table public.chat_faq_items enable row level security;
alter table public.chat_faq_suggestions enable row level security;
revoke all on public.chat_faq_items,public.chat_faq_suggestions from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.chat_faq_items to service_role;
grant select,insert on public.chat_faq_suggestions to service_role;

-- The Admins room.
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check check(room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check check(room_slug in ('main','social','shortscout','gainers','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check check(return_room in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new','developers','admins'));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','developers','admins'));
alter table public.chat_room_summary_cache drop constraint chat_room_summary_cache_room_slug_check;
alter table public.chat_room_summary_cache add constraint chat_room_summary_cache_room_slug_check check(room_slug in ('main','social','shortscout','developers','admins'));
alter table public.chat_summary_deliveries drop constraint chat_summary_deliveries_room_slug_check;
alter table public.chat_summary_deliveries add constraint chat_summary_deliveries_room_slug_check check(room_slug in ('main','social','shortscout','developers','admins'));
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers') or
 (room_slug='whats-new' and guest_id is null and member_id is null and bot_slug='whats-new') or
 (room_slug='admins' and guest_id is null and member_id is null and bot_slug='faq-suggestions')
);

insert into public.longboard_chat_room_state(id,room_slug) values(11,'admins');

alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins')) or
 room_slug in ('social','gainers','whats-new','developers') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name from public.longboard_chat_members m
 where (p_cursor is null or m.id>p_cursor)
   and strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 -- UUID keysets remain stable across name edits; the UI sorts the loaded names.
 order by m.id limit 51;
end $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 or p_online_ids is null or cardinality(p_online_ids)>5000 then raise exception 'invalid_query'; end if;
 if ((p_after_rank is null and p_after_name is null and p_after_id is null) or
   (p_after_rank in (0,1) and p_after_name is not null and p_after_id is not null)) is not true then raise exception 'invalid_cursor'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name,case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name)
 from public.longboard_chat_members m
 where strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
   and (p_after_id is null or
     (case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id) >
     (p_after_rank,p_after_name collate "C",p_after_id))
 order by case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id
 limit 51;
end $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','admins') then raise exception 'invalid_room'; end if;
 if p_ids is null or cardinality(p_ids) > 50 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id, m.display_name from public.longboard_chat_members m
 where m.id = any(p_ids)
   and public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 order by m.id;
end $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.queue_chat_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  if new.room_slug not in ('main','social','shortscout','developers','admins') then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id
   and not exists(select 1 from public.chat_room_notification_levels p where p.account_id=new.account_id and p.room_slug=new.room_slug and p.level='muted')
  on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.queue_longboard_chat_embedding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if new.deleted_at is not null or new.removed or new.room_slug not in ('main','social','shortscout','developers','admins') then
  delete from public.longboard_chat_embeddings where message_id=new.id;
 else
  insert into public.longboard_chat_embeddings(message_id,content_hash)
  values(new.id,md5(new.author_label || E'\n' || new.body))
  on conflict(message_id) do update set content_hash=excluded.content_hash,embedding=null,
   lease_id=null,available_at=now(),attempts=0,indexed_at=null,input_tokens=0;
 end if;
 return new;
end; $function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.claim_longboard_chat_embeddings()
 RETURNS TABLE(message_id uuid, content_hash text, lease_id uuid, content text)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
 with pending as (
  select e.message_id from public.longboard_chat_embeddings e
  join public.longboard_chat_messages m on m.id=e.message_id
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout','developers','admins')
   and e.content_hash=md5(m.author_label || E'\n' || m.body) and e.embedding is null and e.attempts<8 and e.available_at<=now()
  order by e.available_at,e.message_id limit 32 for update of e skip locked
 ), claimed as (
  update public.longboard_chat_embeddings e set lease_id=gen_random_uuid(),
   available_at=now()+interval '5 minutes',attempts=e.attempts+1
  from pending p where e.message_id=p.message_id
  returning e.message_id,e.content_hash,e.lease_id
 ) select c.message_id,c.content_hash,c.lease_id,m.author_label || E'\n' || m.body
 from claimed c join public.longboard_chat_messages m on m.id=c.message_id;
$function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.search_longboard_chat(p_query text, p_room text DEFAULT 'main'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, room_slug text, author_label text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m
 where not m.removed and m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 and m.room_slug in ('main','social','shortscout','developers','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
 and m.search_document @@ websearch_to_tsquery('simple',p_query)
 and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
 order by m.created_at desc,m.id desc limit 21;
$function$;

-- Current definition with the Admins room added.

CREATE OR REPLACE FUNCTION public.search_longboard_chat_semantic(p_query text, p_embedding extensions.vector, p_room text DEFAULT 'main'::text)
 RETURNS TABLE(id uuid, room_slug text, author_label text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
 with semantic as (
  select m.id,row_number() over(order by e.embedding <=> p_embedding,m.id) as rank
  from public.longboard_chat_embeddings e join public.longboard_chat_messages m on m.id=e.message_id
  where not m.removed and m.deleted_at is null and e.embedding is not null and e.model='text-embedding-3-small'
   and m.room_slug in ('main','social','shortscout','developers','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
   and e.content_hash=md5(m.author_label || E'\n' || m.body)
   and e.embedding <=> p_embedding < 0.75
  order by e.embedding <=> p_embedding,m.id limit 40
 ), keywords as (
  select m.id,row_number() over(order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id) as rank
  from public.longboard_chat_messages m
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout','developers','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
   and m.search_document @@ websearch_to_tsquery('simple',p_query)
  order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id limit 40
 ), scores as (
  select coalesce(s.id,k.id) id,coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+k.rank),0) score
  from semantic s full join keywords k on k.id=s.id
 ) select m.id,m.room_slug,m.author_label,m.body,m.created_at
 from scores s join public.longboard_chat_messages m on m.id=s.id
 where not m.removed and m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 order by s.score desc,m.created_at desc,m.id limit 20;
$function$;

-- #332: one suggestion from a verified member, posted to the Admins room.
create function public.post_chat_faq_suggestion(p_member uuid,p_topic text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid(); who text; clean text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
begin
 if char_length(clean) not between 1 and 300 then raise exception 'invalid_faq_suggestion'; end if;
 select m.display_name into who from public.longboard_chat_members m where m.id=p_member;
 if who is null then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_faq_suggestions:'||p_member::text,0));
 if exists(select 1 from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 minute')
  or (select count(*) from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 day')>=5
 then raise exception 'faq_suggestion_rate_limited'; end if;
 insert into public.chat_faq_suggestions(message_id,topic,suggested_by) values(note_id,clean,p_member);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'admins','FAQ Suggestions',who||' suggested an FAQ topic: '||clean,'faq-suggestions');
 return jsonb_build_object('messageId',note_id,'posted',true);
end $$;
revoke all on function public.post_chat_faq_suggestion(uuid,text) from public,anon,authenticated;
grant execute on function public.post_chat_faq_suggestion(uuid,text) to service_role;

-- Starter items.
insert into public.chat_faq_items(question,answer,position) values
('How do I get the chat on my phone?',
$faq$The chat is a web app, so there is nothing to download from the App Store or Google Play. You add it to your phone's home screen from the browser.

iPhone (use Safari)
1. Open https://www.longboardai.com/chat in Safari and sign in.
2. Tap Share (you may need to open Safari's page menu first).
3. Choose Add to Home Screen. If offered, turn on Open as Web App, then tap Add.
4. Open the new Rob Booker Chat icon on your home screen. Sign in again if asked.

Android (use Chrome)
1. Open https://www.longboardai.com/chat in Chrome and sign in.
2. Tap Chrome's ⋮ menu beside the address bar (not the chat's own menu).
3. Choose Install and create shortcut, then Install. Depending on your Chrome version this may say Add to Home screen or Install app.
4. Follow the prompts, then open the new icon. It may be labeled Rob Booker Chat or RB Chat.

You can also find these steps in the chat: open the ⋯ menu and choose Install on phone.$faq$,
10),
('How do I turn on phone notifications?',
$faq$Notifications tell you about direct messages and mentions, even when the chat is closed. Each phone is set up on its own.

iPhone
You need iOS 16.4 or later, and the chat must be on your home screen first. Notifications can't be turned on from a Safari tab. See "How do I get the chat on my phone?" above.
1. Open the chat from its icon on your home screen.
2. Open the ⋯ menu and choose Phone notifications.
3. Tap Enable notifications, then Allow when your phone asks.
4. Tap Send test notification to check it works.

Android
You can do this in Chrome or in the installed app.
1. Open the chat.
2. Open the ⋯ menu and choose Phone notifications.
3. Tap Enable notifications, then Allow when your phone asks.
4. Tap Send test notification to check it works.

If you see a bell with a slash through it at the top of the chat, notifications are off on this phone. Tap it to get started.

Not getting them?
If you blocked notifications earlier, the chat can't ask again. On iPhone, go to Settings, then Notifications, choose Rob Booker Chat and turn on Allow Notifications. On Android, tap the lock or ⋮ by the address bar, then Site settings, and set Notifications to Allow. In the installed Android app, hold its icon and choose App info instead. Focus or Do Not Disturb can also silence notifications.$faq$,
20);
