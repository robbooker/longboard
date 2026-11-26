-- #524 Webinar notices: Booker Stock Club, a link to the recording, long broadcasts and big rooms.
--
-- 1. public.chat_stage_broadcasts (new, small): one row per announced broadcast of a room's live
--    video, keyed by its "live now" room message (notice_id). It is what the server could not know
--    before: when the broadcast started, when it was last seen live, when it ended, the recording's
--    link, and whether everyone's bell entry has been written. RLS on, no policies: only the service
--    role reads or writes it, and only through the app's stage code and the functions below.
--    At most one row per room is open (ended_at null): the database refuses a second one, so a room
--    can never have two "live now" messages however many servers look at once.
-- 2. Five functions, service role only (security invoker, like post_chat_longboard_announcement):
--    chat_stage_broadcast_open       the "live now" message and its row, in one transaction; a
--                                    stale open broadcast of the room is marked ended first
--    chat_stage_broadcast_close      the broadcast ended: the row, the message's words, its bells
--    chat_stage_broadcast_reopen     it came back shortly after ending: the same message says live
--    chat_stage_broadcast_recording  sets, changes or removes an ended broadcast's recording link
--    chat_stage_broadcast_notify     writes bell entries for the next slice of the room's members
--                                    and remembers how far it got, so a retry finishes the job
-- 3. enforce_chat_club_post (Booker Stock Club's guard): the definition from
--    20261115120000_chat_club_admin_posts.sql with ONE exception added to "a bot's post there never
--    changes": Longboard Bot's own live-video notice (a row of chat_stage_broadcasts for the club)
--    may have its words changed by the functions above, and nothing else about it. Everything else
--    is as it was: nothing moves into or out of the club, people's posts follow the same rules, the
--    stock-pick cards and every other bot post never change.
-- 4. queue_chat_push: the definition from 20261121130000_chat_ai_insights.sql with ONE addition: a
--    bell entry in the club is sent to phones when it belongs to a live-video notice. Replies and
--    @names in the club stay out of phone push, as before.
--
-- Not changed: Gainers (webinars are not offered there; the app no longer tries), every room check
-- (chat_room_mentions_room_slug_check already has 'club'), post_chat_longboard_announcement.
-- The block below stops the migration if either changed function is not the definition this was
-- written against, rather than overwriting something newer.
--
-- Additive: the running app keeps working once this is applied (it keeps using its own direct
-- writes; nothing reads the new table until the app from #524 ships). Apply it before that app.
-- No table is rewritten and no existing row is changed; the only locks are the brief ones of
-- CREATE OR REPLACE FUNCTION and creating an empty table. Apply it as one transaction (as the
-- migration tool does), so a failed check leaves nothing behind.
-- Rollback: supabase/rollbacks/20261126120000_chat_stage_broadcasts.down.sql

do $$
begin
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_chat_club_post') is distinct from '719dc4ec7c9a4e58b9e12892606ce8b7'
  then raise exception 'enforce_chat_club_post is not the expected definition: read it and add the live-video notice exception by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='queue_chat_push') is distinct from 'b9feb024c9af1cfa01b87c1c4b970236'
  then raise exception 'queue_chat_push is not the expected definition: read it and add the club live-video notice by hand'; end if;
end $$;

create table public.chat_stage_broadcasts(
 notice_id uuid primary key,
 room_slug text not null,
 started_at timestamptz not null,
 last_live_at timestamptz not null,
 ended_at timestamptz,
 recording_url text check (recording_url is null or char_length(recording_url) between 12 and 300),
 -- Who set (or removed) the recording: a post in the room's recordings room, or an admin by hand.
 recording_source text check (recording_source in ('post','admin')),
 -- Bell entries: how far through the member list they have been written, and when that finished.
 notify_cursor uuid,
 notified_at timestamptz,
 created_at timestamptz not null default now()
);
create index chat_stage_broadcasts_room on public.chat_stage_broadcasts(room_slug,created_at desc);
create unique index chat_stage_broadcasts_open on public.chat_stage_broadcasts(room_slug) where ended_at is null;
alter table public.chat_stage_broadcasts enable row level security;
revoke all on public.chat_stage_broadcasts from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_stage_broadcasts to service_role;

-- The notice's words change (and nothing else of the row). The setting names the one message the
-- club's guard lets through; it lasts for this transaction only.
create function public.chat_stage_notice_rewrite(p_id uuid,p_body text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid_stage_notice'; end if;
 perform set_config('chat.stage_notice',p_id::text,true);
 update public.longboard_chat_messages set body=btrim(p_body),edited_at=now(),revision=revision+1
  where id=p_id and bot_slug='longboard' and deleted_at is null and body is distinct from btrim(p_body);
 perform set_config('chat.stage_notice','',true);
end $$;

-- A broadcast is on: its "live now" message and its row, together or not at all.
--  posted true: this call announced it (the caller then writes the bells).
--  posted false: the id was already there (another server announced it a moment ago; or a notice
--  from before this table existed, which gets its row now, ended or live as its words say).
-- Before a new open row is written, an open broadcast the room still has (its end was never seen)
-- is marked ended: its message says so (p_stale_body) and its bells are taken back.
create function public.chat_stage_broadcast_open(p_id uuid,p_room text,p_body text,p_started_at timestamptz,p_stale_body text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare posted boolean; stale record; closed integer:=0; legacy public.longboard_chat_messages; live boolean:=true;
begin
 if p_id is null or p_room is null or p_started_at is null then raise exception 'invalid_stage_notice'; end if;
 if exists(select 1 from public.chat_stage_broadcasts where notice_id=p_id) then return jsonb_build_object('posted',false); end if;
 posted:=coalesce((public.post_chat_longboard_announcement(p_id,p_room,p_body)->>'posted')::boolean,false);
 if not posted then
  select * into legacy from public.longboard_chat_messages where id=p_id;
  live:=legacy.body is not distinct from btrim(p_body) and legacy.deleted_at is null;
 end if;
 if live then
  for stale in select notice_id from public.chat_stage_broadcasts where room_slug=p_room and ended_at is null and notice_id<>p_id for update loop
   update public.chat_stage_broadcasts set ended_at=greatest(last_live_at,started_at) where notice_id=stale.notice_id;
   perform public.chat_stage_notice_rewrite(stale.notice_id,p_stale_body);
   delete from public.chat_room_mentions where message_id=stale.notice_id;
   closed:=closed+1;
  end loop;
 end if;
 if posted then
  insert into public.chat_stage_broadcasts(notice_id,room_slug,started_at,last_live_at) values(p_id,p_room,least(p_started_at,now()),now());
 else
  insert into public.chat_stage_broadcasts(notice_id,room_slug,started_at,last_live_at,ended_at,notified_at)
   values(p_id,p_room,legacy.created_at,case when live then now() else coalesce(legacy.edited_at,legacy.created_at) end,
    case when live then null else coalesce(legacy.edited_at,legacy.created_at) end,now())
   on conflict(notice_id) do nothing;
 end if;
 return jsonb_build_object('posted',posted,'closed',closed);
end $$;

-- The broadcast is over (true only for the one call that marked it): the message says so, and its
-- bell entries (and so any phone notification not yet sent) are taken back.
create function public.chat_stage_broadcast_close(p_id uuid,p_body text,p_ended_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.chat_stage_broadcasts set ended_at=least(greatest(coalesce(p_ended_at,now()),started_at),now())
  where notice_id=p_id and ended_at is null;
 if not found then return false; end if;
 perform public.chat_stage_notice_rewrite(p_id,p_body);
 delete from public.chat_room_mentions where message_id=p_id;
 return true;
end $$;

-- The same broadcast is back shortly after ending: its message says live again. Nobody is notified.
create function public.chat_stage_broadcast_reopen(p_id uuid,p_body text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.chat_stage_broadcasts set ended_at=null,last_live_at=now()
  where notice_id=p_id and ended_at is not null;
 if not found then return false; end if;
 perform public.chat_stage_notice_rewrite(p_id,p_body);
 return true;
end $$;

-- An ended broadcast's recording link: set, changed or (p_url null) removed, with the message's new
-- words. p_only_if_empty: only when nobody has set or removed one yet (the first link posted in
-- the recordings room wins; an admin's choice is never overwritten by a later post).
-- An ended notice from before this table existed gets its row here.
create function public.chat_stage_broadcast_recording(p_id uuid,p_room text,p_url text,p_body text,p_source text,p_only_if_empty boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_source is null or p_source not in ('post','admin') then raise exception 'invalid_stage_notice'; end if;
 insert into public.chat_stage_broadcasts(notice_id,room_slug,started_at,last_live_at,ended_at,notified_at)
  select m.id,m.room_slug,m.created_at,coalesce(m.edited_at,m.created_at),coalesce(m.edited_at,m.created_at),now()
  from public.longboard_chat_messages m
  where m.id=p_id and m.room_slug=p_room and m.bot_slug='longboard' and m.deleted_at is null
   and m.body ~ '^The live video in [^\n]{1,60} has ended\.$'
  on conflict(notice_id) do nothing;
 update public.chat_stage_broadcasts set recording_url=p_url,recording_source=p_source
  where notice_id=p_id and room_slug=p_room and ended_at is not null
   and (not coalesce(p_only_if_empty,false) or (recording_url is null and recording_source is null));
 if not found then return false; end if;
 perform public.chat_stage_notice_rewrite(p_id,p_body);
 return true;
end $$;

-- Bell entries for the next p_limit members of the room's list (in id order, from where the last
-- call stopped). Told: everyone who can read the room now (chat_account_room_recipient_eligible, the
-- rule every room notification uses), except bot accounts, anyone who set the room to "Mentions
-- only" or "Muted", and p_skip. No personal block is applied: this is the room's notice, not a
-- person's. One row per account and message (the unique key), so running it again adds nothing.
-- done true: the whole list has been covered (or the broadcast is over, or it was already done).
create function public.chat_stage_broadcast_notify(p_id uuid,p_skip uuid,p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.chat_stage_broadcasts; scanned integer; last_id uuid; added integer;
begin
 if p_limit is null or p_limit not between 1 and 2000 then raise exception 'invalid_stage_notice'; end if;
 -- One caller at a time per broadcast; a second waits and then carries on from the new place.
 select * into b from public.chat_stage_broadcasts where notice_id=p_id for update;
 if not found or b.ended_at is not null or b.notified_at is not null then return jsonb_build_object('done',true,'added',0); end if;
 with page as (
  select m.id,m.user_id from public.longboard_chat_members m
  where b.notify_cursor is null or m.id>b.notify_cursor order by m.id limit p_limit
 ), told as (
  insert into public.chat_room_mentions(account_id,message_id,room_slug)
  select page.user_id,p_id,b.room_slug from page
  where page.user_id is not null and page.user_id is distinct from p_skip
   and public.chat_account_room_recipient_eligible(page.user_id,b.room_slug)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=page.user_id)
   and not exists(select 1 from public.chat_room_notification_levels l
    where l.account_id=page.user_id and l.room_slug=b.room_slug and l.level in ('mentions','muted'))
  on conflict(account_id,message_id) do nothing returning 1
 )
 select (select count(*) from page),(select id from page order by id desc limit 1),(select count(*) from told) into scanned,last_id,added;
 update public.chat_stage_broadcasts set notify_cursor=coalesce(last_id,notify_cursor),
  notified_at=case when scanned<p_limit then now() end where notice_id=p_id;
 return jsonb_build_object('done',scanned<p_limit,'added',added);
end $$;

revoke all on function public.chat_stage_notice_rewrite(uuid,text) from public,anon,authenticated;
revoke all on function public.chat_stage_broadcast_open(uuid,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.chat_stage_broadcast_close(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.chat_stage_broadcast_reopen(uuid,text) from public,anon,authenticated;
revoke all on function public.chat_stage_broadcast_recording(uuid,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.chat_stage_broadcast_notify(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.chat_stage_notice_rewrite(uuid,text) to service_role;
grant execute on function public.chat_stage_broadcast_open(uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.chat_stage_broadcast_close(uuid,text,timestamptz) to service_role;
grant execute on function public.chat_stage_broadcast_reopen(uuid,text) to service_role;
grant execute on function public.chat_stage_broadcast_recording(uuid,text,text,text,text,boolean) to service_role;
grant execute on function public.chat_stage_broadcast_notify(uuid,uuid,integer) to service_role;

-- 20261115120000_chat_club_admin_posts.sql's definition with the #524 exception (the block marked #524).
CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare parent public.longboard_chat_messages;
begin
 -- #524: the one bot post in the club whose words may change: Longboard Bot's live-video notice (a
 -- row of chat_stage_broadcasts for the club), rewritten by public.chat_stage_notice_rewrite, which
 -- names it in a setting for its own transaction. Only body, edited_at and revision may differ
 -- (and what the room's own triggers keep: the search text and the event numbers).
 if tg_op='UPDATE' and old.room_slug='club' and new.room_slug='club' and old.guest_id is null
  and old.bot_slug='longboard' and coalesce(current_setting('chat.stage_notice',true),'')=old.id::text
  and exists(select 1 from public.chat_stage_broadcasts b where b.notice_id=old.id and b.room_slug='club')
  and new.id=old.id and new.guest_id is null and new.member_id is null and new.agent_id is null
  and new.bot_slug='longboard' and new.author_label=old.author_label
  and new.reply_to_id is not distinct from old.reply_to_id and new.attachment_ids=old.attachment_ids
  and new.created_at=old.created_at and new.deleted_at is not distinct from old.deleted_at
  and new.client_id is not distinct from old.client_id and new.removed is not distinct from old.removed
  and new.answered_id is not distinct from old.answered_id and new.buddy_status is not distinct from old.buddy_status
 then return new; end if;
 -- Nothing moves into or out of the club, and a bot's post there never changes.
 if tg_op='UPDATE' and (old.room_slug='club' or new.room_slug='club')
  and (old.room_slug<>new.room_slug or old.guest_id is null) then raise exception 'club_read_only'; end if;
 if new.room_slug='club' then
  if new.guest_id is not null then
   -- #457: a person's post: only a chat admin's own (never an agent's), with text, photos, links.
   if new.bot_slug is not null or new.agent_id is not null
    or coalesce(current_setting('chat.agent_id',true),'')<>''
   then raise exception 'club_read_only'; end if;
   -- A new post, or new words or files on one, needs its author to be an admin now.
   if (tg_op='INSERT' or (new.deleted_at is null
     and (new.body is distinct from old.body or new.attachment_ids is distinct from old.attachment_ids)))
    and not (new.member_id is not null and new.member_id=new.guest_id and exists(
     select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
     where m.id=new.member_id and p.role='admin'))
   then raise exception 'club_read_only'; end if;
  elsif tg_op<>'INSERT' or new.member_id is not null
   or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not ((new.bot_slug='club' and new.author_label='Booker Stock Club'
     and exists(select 1 from public.chat_club_picks p where p.message_id=new.id))
    or (new.bot_slug='longboard' and new.author_label='Longboard Bot'))
  then raise exception 'club_read_only'; end if;
 end if;
 -- A reply under a club post: only an admin's club post (checked above) under a person's post, never
 -- under the bot's, and never from another room.
 if new.reply_to_id is not null and (tg_op='INSERT' or new.reply_to_id is distinct from old.reply_to_id) then
  select * into parent from public.longboard_chat_messages where id=new.reply_to_id;
  if found and parent.room_slug='club' and (new.room_slug<>'club' or new.guest_id is null
    or parent.guest_id is null or parent.bot_slug is not null)
  then raise exception 'club_read_only'; end if;
 end if;
 return new;
end $function$;

-- 20261121130000_chat_ai_insights.sql's definition with the #524 addition (the second half of the room test).
CREATE OR REPLACE FUNCTION public.queue_chat_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  -- #524: and, in Booker Stock Club, the bell entries of a live-video notice (nothing else there).
  if new.room_slug not in ('main','social','shortscout','developers','lb-review','runner-watch','admins','ai-insights')
   and not (new.room_slug='club' and exists(select 1 from public.chat_stage_broadcasts b where b.notice_id=new.message_id))
  then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id
   and not exists(select 1 from public.chat_room_notification_levels p where p.account_id=new.account_id and p.room_slug=new.room_slug and p.level='muted')
  on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $function$;
