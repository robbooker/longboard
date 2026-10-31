-- #341 Runner Watch: a room for Jake's "All Runner Risk Watch" report, and the store behind it.
--
-- Room
--  * Room slug 'runner-watch' (room_state id 13). A full conversation room like LB Review: every chat
--    member is in it with no joining step, and can post, reply, react, tag, attach files and pin.
--  * Each function below is the current definition with only 'runner-watch' added next to 'lb-review'.
--    Production and preview had identical definitions on 2026-10-31, read from both, and these were
--    generated from them.
--
-- Bot
--  * Posts carry bot_slug 'runner-watch', as the Gainers alerts do: no login, no member row, no API
--    token, so it can't read anything. The actor check below is what limits it: bot_slug 'runner-watch'
--    is only valid in runner-watch, main (LB) and shortscout (SS), so the database refuses it anywhere
--    else. It has no member id, so it can't tag anyone or wake Buddy.
--  * Main rooms: only alerts (main_alerts_only, on by default), and main_max_per_day each (default 3).
--    chat_runner_watch_room_posts has one row per report and room, so a report can't post twice in a room.
--  * 'runner-watch-notices' is the same thing for the Admins room, and only writes the held-back note.
--
-- Reports
--  * chat_runner_watch_reports: one row per update, written only by ingest_chat_runner_watch through
--    /api/chat/runner-watch (its own secret), read by /runner-watch/<id> after a chat access check.
--    RLS on, no policies, service role only. Plain text only; the page escapes everything.
--  * chat_runner_watch_settings: one row. The off switch, alerts-only, and the limits. Changed from
--    /admin/runner-watch or directly in the table, with no deploy. Limits start at 12 an hour, 60 a day.
--
-- Existing functions changed (exact previous bodies are in the rollback):
--   chat_account_has_room, chat_account_room_recipient_eligible, claim_longboard_chat_embeddings, longboard_chat_room_member_count, longboard_chat_room_member_names, longboard_chat_room_members, longboard_chat_room_members_ordered, queue_chat_push, queue_longboard_chat_embedding, search_longboard_chat, search_longboard_chat_semantic.
-- Existing constraints changed: the ten room_slug checks and the message actor check. Existing policy changed: "members read chat messages".
--
-- Additive: the running app keeps working once this is applied. Apply it before the app that lists the room ships.
-- Needs #340 (20261031120000_chat_lb_review.sql) first.
-- Rollback: supabase/rollbacks/20261031150000_chat_runner_watch.down.sql

create table public.chat_runner_watch_settings(
 id boolean primary key default true check(id),
 enabled boolean not null default true,
 alerts_only boolean not null default false,
 max_per_hour integer not null default 12 check(max_per_hour between 1 and 1000),
 max_per_day integer not null default 60 check(max_per_day between 1 and 10000),
 main_alerts_only boolean not null default true,
 main_max_per_day integer not null default 3 check(main_max_per_day between 0 and 100),
 last_notice_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid
);
insert into public.chat_runner_watch_settings(id) values(true);
alter table public.chat_runner_watch_settings enable row level security;
revoke all on public.chat_runner_watch_settings from public,anon,authenticated,service_role;
grant select,update on public.chat_runner_watch_settings to service_role;

-- The room.
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check check(room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check check(return_room in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','lb-recordings','ss-recordings','developers','admins','lb-review','runner-watch'));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check check(room_slug in ('main','social','shortscout','gainers','lb-announcements','ss-announcements','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));
alter table public.chat_room_summary_cache drop constraint chat_room_summary_cache_room_slug_check;
alter table public.chat_room_summary_cache add constraint chat_room_summary_cache_room_slug_check check(room_slug in ('main','social','shortscout','developers','admins','lb-review','runner-watch'));
alter table public.chat_summary_deliveries drop constraint chat_summary_deliveries_room_slug_check;
alter table public.chat_summary_deliveries add constraint chat_summary_deliveries_room_slug_check check(room_slug in ('main','social','shortscout','developers','admins','lb-review','runner-watch'));
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch'));

alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers') or
 (room_slug='whats-new' and guest_id is null and member_id is null and bot_slug='whats-new') or
 (room_slug='admins' and guest_id is null and member_id is null and bot_slug='faq-suggestions') or
 -- #341: the feed's bot writes in exactly these three rooms, its notices only in Admins.
 (room_slug in ('runner-watch','main','shortscout') and guest_id is null and member_id is null and bot_slug='runner-watch') or
 (room_slug='admins' and guest_id is null and member_id is null and bot_slug='runner-watch-notices')
);

insert into public.longboard_chat_room_state(id,room_slug) values(13,'runner-watch');

alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','runner-watch')) or
 room_slug in ('social','gainers','whats-new','developers','lb-review','runner-watch') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','runner-watch') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$function$;

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','runner-watch') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.claim_longboard_chat_embeddings()
 RETURNS TABLE(message_id uuid, content_hash text, lease_id uuid, content text)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
 with pending as (
  select e.message_id from public.longboard_chat_embeddings e
  join public.longboard_chat_messages m on m.id=e.message_id
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout','developers','lb-review','runner-watch','admins')
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

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.queue_chat_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  if new.room_slug not in ('main','social','shortscout','developers','lb-review','runner-watch','admins') then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id
   and not exists(select 1 from public.chat_room_notification_levels p where p.account_id=new.account_id and p.room_slug=new.room_slug and p.level='muted')
  on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $function$;

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.queue_longboard_chat_embedding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if new.deleted_at is not null or new.removed or new.room_slug not in ('main','social','shortscout','developers','lb-review','runner-watch','admins') then
  delete from public.longboard_chat_embeddings where message_id=new.id;
 else
  insert into public.longboard_chat_embeddings(message_id,content_hash)
  values(new.id,md5(new.author_label || E'\n' || new.body))
  on conflict(message_id) do update set content_hash=excluded.content_hash,embedding=null,
   lease_id=null,available_at=now(),attempts=0,indexed_at=null,input_tokens=0;
 end if;
 return new;
end; $function$;

-- Current definition with Runner Watch added.

CREATE OR REPLACE FUNCTION public.search_longboard_chat(p_query text, p_room text DEFAULT 'main'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, room_slug text, author_label text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m
 where not m.removed and m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 and m.room_slug in ('main','social','shortscout','developers','lb-review','runner-watch','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
 and m.search_document @@ websearch_to_tsquery('simple',p_query)
 and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
 order by m.created_at desc,m.id desc limit 21;
$function$;

-- Current definition with Runner Watch added.

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
   and m.room_slug in ('main','social','shortscout','developers','lb-review','runner-watch','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
   and e.content_hash=md5(m.author_label || E'\n' || m.body)
   and e.embedding <=> p_embedding < 0.75
  order by e.embedding <=> p_embedding,m.id limit 40
 ), keywords as (
  select m.id,row_number() over(order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id) as rank
  from public.longboard_chat_messages m
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout','developers','lb-review','runner-watch','admins') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
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

-- The reports. Comes after the room so the message link and functions see the new checks.
create table public.chat_runner_watch_reports(
 id uuid primary key,
 dedupe_key text not null unique check(char_length(dedupe_key) between 1 and 200),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 tickers text[] not null default '{}' check(cardinality(tickers)<=20),
 summary text not null check(char_length(summary) between 1 and 1000),
 full_text text not null check(char_length(full_text) between 1 and 50000),
 post_body text not null check(char_length(post_body) between 1 and 600),
 main_post_body text not null check(char_length(main_post_body) between 1 and 600),
 is_alert boolean not null default false,
 sent_at timestamptz,
 status text not null check(status in ('posted','held','saved')),
 message_id uuid references public.longboard_chat_messages(id) on delete set null,
 received_at timestamptz not null default now(),
 posted_at timestamptz,
 check((status='posted')=(posted_at is not null))
);
create index chat_runner_watch_reports_posted on public.chat_runner_watch_reports(posted_at desc) where status='posted';
create index chat_runner_watch_reports_held on public.chat_runner_watch_reports(received_at desc) where status='held';
create index chat_runner_watch_reports_hash on public.chat_runner_watch_reports(content_hash);
alter table public.chat_runner_watch_reports enable row level security;
revoke all on public.chat_runner_watch_reports from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_runner_watch_reports to service_role;

-- One row per report and room: the database's own guarantee of one post per room, resends included.
create table public.chat_runner_watch_room_posts(
 report_id uuid not null references public.chat_runner_watch_reports(id) on delete cascade,
 room_slug text not null check(room_slug in ('runner-watch','main','shortscout')),
 message_id uuid references public.longboard_chat_messages(id) on delete set null,
 posted_at timestamptz not null default now(),
 primary key(report_id,room_slug)
);
create index chat_runner_watch_room_posts_day on public.chat_runner_watch_room_posts(room_slug,posted_at desc);
alter table public.chat_runner_watch_room_posts enable row level security;
revoke all on public.chat_runner_watch_room_posts from public,anon,authenticated,service_role;
grant select,insert on public.chat_runner_watch_room_posts to service_role;

-- After a report posts in Runner Watch: LB and SS, for alerts unless main_alerts_only is switched off,
-- up to main_max_per_day each. A full or paused main room is skipped; it never costs Runner Watch its post.
create function public.chat_runner_watch_post_main(p_report uuid,p_body text,p_alert boolean,p_admin_url text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.chat_runner_watch_settings; room text; posted text[]:='{}'; full_rooms text[]:='{}'; note_id uuid; told boolean:=false;
begin
 select * into s from public.chat_runner_watch_settings limit 1;
 if s.main_alerts_only and not p_alert then return jsonb_build_object('rooms',posted,'capped',full_rooms,'told',false); end if;
 foreach room in array array['main','shortscout'] loop
  if exists(select 1 from public.chat_runner_watch_room_posts p where p.report_id=p_report and p.room_slug=room) then continue; end if;
  if (select count(*) from public.chat_runner_watch_room_posts p where p.room_slug=room and p.posted_at>now()-interval '1 day')>=s.main_max_per_day then
   full_rooms:=array_append(full_rooms,room); continue;
  end if;
  begin
   note_id:=gen_random_uuid();
   insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug) values(note_id,room,'Runner Risk Watch',btrim(p_body),'runner-watch');
   insert into public.chat_runner_watch_room_posts(report_id,room_slug,message_id) values(p_report,room,note_id);
   posted:=array_append(posted,room);
  exception when others then null;
  end;
 end loop;
 if cardinality(full_rooms)>0 and (s.last_notice_at is null or s.last_notice_at<now()-interval '1 hour') then
  begin
   insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
    values(gen_random_uuid(),'admins','Runner Watch Notices','A Runner Risk Watch alert did not go to the main rooms because the limit of '||s.main_max_per_day||' a day was reached. It is still in Runner Watch. Settings: '||p_admin_url,'runner-watch-notices');
   update public.chat_runner_watch_settings set last_notice_at=now();
   told:=true;
  exception when others then told:=false;
  end;
 end if;
 return jsonb_build_object('rooms',posted,'capped',full_rooms,'told',told);
end $$;
revoke all on function public.chat_runner_watch_post_main(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.chat_runner_watch_post_main(uuid,text,boolean,text) to service_role;

-- One update. Everything happens under one lock, so two copies at once still post once and the limits
-- can't be raced. Returns a status rather than raising, except for a paused room, which rolls back
-- so the sender can simply send it again.
create function public.ingest_chat_runner_watch(p_id uuid,p_key text,p_hash text,p_tickers text[],p_summary text,p_full_text text,p_post text,p_main_post text,p_alert boolean,p_sent_at timestamptz,p_admin_url text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.chat_runner_watch_settings; old_status text; same uuid; last_hour integer; last_day integer; note_id uuid:=gen_random_uuid(); told boolean:=false; main jsonb;
begin
 if p_id is null or p_key is null or p_hash is null or p_tickers is null or p_summary is null or p_full_text is null or p_post is null or p_main_post is null or p_alert is null or p_admin_url is null
 then raise exception 'invalid_runner_watch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-runner-watch',0));
 select * into s from public.chat_runner_watch_settings limit 1;
 if not found or not s.enabled then return jsonb_build_object('status','off'); end if;
 select r.status into old_status from public.chat_runner_watch_reports r where r.dedupe_key=p_key;
 if old_status='posted' then return jsonb_build_object('status','duplicate','reportId',p_id); end if;
 -- A sender that makes a new id each run: the same words within a day still count as the same update.
 select r.id into same from public.chat_runner_watch_reports r
  where r.content_hash=p_hash and r.dedupe_key<>p_key and r.status in ('posted','held') and r.received_at>now()-interval '1 day' limit 1;
 if same is not null then return jsonb_build_object('status','duplicate','reportId',same); end if;
 if s.alerts_only and not p_alert then
  insert into public.chat_runner_watch_reports(id,dedupe_key,content_hash,tickers,summary,full_text,post_body,main_post_body,is_alert,sent_at,status)
   values(p_id,p_key,p_hash,p_tickers,p_summary,p_full_text,p_post,p_main_post,p_alert,p_sent_at,'saved')
   on conflict(dedupe_key) do update set content_hash=excluded.content_hash,tickers=excluded.tickers,summary=excluded.summary,full_text=excluded.full_text,post_body=excluded.post_body,main_post_body=excluded.main_post_body,is_alert=excluded.is_alert,sent_at=excluded.sent_at,status='saved';
  return jsonb_build_object('status','saved','reportId',p_id);
 end if;
 select count(*) filter(where r.posted_at>now()-interval '1 hour'),count(*) into last_hour,last_day
  from public.chat_runner_watch_reports r where r.status='posted' and r.posted_at>now()-interval '1 day';
 if last_hour>=s.max_per_hour or last_day>=s.max_per_day then
  -- A feed that keeps going stops being stored too.
  if old_status is null and (select count(*) from public.chat_runner_watch_reports r where r.status='held' and r.received_at>now()-interval '1 day')>=200
  then return jsonb_build_object('status','refused'); end if;
  insert into public.chat_runner_watch_reports(id,dedupe_key,content_hash,tickers,summary,full_text,post_body,main_post_body,is_alert,sent_at,status)
   values(p_id,p_key,p_hash,p_tickers,p_summary,p_full_text,p_post,p_main_post,p_alert,p_sent_at,'held')
   on conflict(dedupe_key) do update set content_hash=excluded.content_hash,tickers=excluded.tickers,summary=excluded.summary,full_text=excluded.full_text,post_body=excluded.post_body,main_post_body=excluded.main_post_body,is_alert=excluded.is_alert,sent_at=excluded.sent_at,status='held';
  -- Tell the admins at most once an hour. A paused Admins room must not lose the update.
  if s.last_notice_at is null or s.last_notice_at<now()-interval '1 hour' then
   begin
    insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
     values(note_id,'admins','Runner Watch Notices','Runner Risk Watch is sending too many updates ('||last_hour||' posted in the last hour, '||last_day||' in the last day; limits '||s.max_per_hour||' and '||s.max_per_day||'). New ones are being held back and not posted. Review them or switch the feed off here: '||p_admin_url,'runner-watch-notices');
    update public.chat_runner_watch_settings set last_notice_at=now();
    told:=true;
   exception when others then told:=false;
   end;
  end if;
  return jsonb_build_object('status','held','reportId',p_id,'told',told);
 end if;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'runner-watch','Runner Risk Watch',btrim(p_post),'runner-watch');
 insert into public.chat_runner_watch_reports(id,dedupe_key,content_hash,tickers,summary,full_text,post_body,main_post_body,is_alert,sent_at,status,message_id,posted_at)
  values(p_id,p_key,p_hash,p_tickers,p_summary,p_full_text,p_post,p_main_post,p_alert,p_sent_at,'posted',note_id,now())
  on conflict(dedupe_key) do update set content_hash=excluded.content_hash,tickers=excluded.tickers,summary=excluded.summary,full_text=excluded.full_text,post_body=excluded.post_body,main_post_body=excluded.main_post_body,is_alert=excluded.is_alert,sent_at=excluded.sent_at,status='posted',message_id=note_id,posted_at=now();
 insert into public.chat_runner_watch_room_posts(report_id,room_slug,message_id) values(p_id,'runner-watch',note_id);
 main:=public.chat_runner_watch_post_main(p_id,p_main_post,p_alert,p_admin_url);
 return jsonb_build_object('status','posted','reportId',p_id,'messageId',note_id)||main;
end $$;
revoke all on function public.ingest_chat_runner_watch(uuid,text,text,text[],text,text,text,text,boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ingest_chat_runner_watch(uuid,text,text,text[],text,text,text,text,boolean,timestamptz,text) to service_role;

-- An admin's "Post now" for one held update. An admin's press overrides the limits; the off switch still wins.
create function public.release_chat_runner_watch(p_id uuid,p_admin_url text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid(); body text; main_body text; alert boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('chat-runner-watch',0));
 if not coalesce((select s.enabled from public.chat_runner_watch_settings s limit 1),false) then return jsonb_build_object('status','off'); end if;
 select r.post_body,r.main_post_body,r.is_alert into body,main_body,alert from public.chat_runner_watch_reports r where r.id=p_id and r.status='held';
 if body is null then return jsonb_build_object('status','not_held'); end if;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'runner-watch','Runner Risk Watch',btrim(body),'runner-watch');
 update public.chat_runner_watch_reports set status='posted',message_id=note_id,posted_at=now() where id=p_id;
 insert into public.chat_runner_watch_room_posts(report_id,room_slug,message_id) values(p_id,'runner-watch',note_id);
 return jsonb_build_object('status','posted','messageId',note_id)||public.chat_runner_watch_post_main(p_id,main_body,alert,p_admin_url);
end $$;
revoke all on function public.release_chat_runner_watch(uuid,text) from public,anon,authenticated;
grant execute on function public.release_chat_runner_watch(uuid,text) to service_role;
