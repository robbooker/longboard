-- #482 AI Insights: a room with one AI write-up of the ShortScout room each trading day, and replies.
--
-- Room
--  * Room slug 'ai-insights' (room_state id 15; 14 is Runner Watch), label "AI Insights".
--  * Access: exactly the members who have the SS room (a ShortScout mastermind member), because it
--    repeats that room's words. Admins have it too, like every room; bot accounts only if listed.
--    chat_account_has_room, chat_account_room_recipient_eligible and chat_account_rooms put it in the
--    SS rule; the four room-member functions accept it. The app's rule: allowedChatRooms in
--    lib/chatAccess.ts (access.shortscout).
--  * Members read, react and reply (through the Reply button). Only the AI and chat admins start a
--    new post (enforce_chat_ai_insights_post below; the app refuses first, canStartChatPost).
--  * Notifications like a normal room: replies and @names in replies reach the bell
--    (chat_room_mentions_room_slug_check), and queue_chat_push sends their phone push unless the
--    member muted the room (chat_room_notification_levels accepts the slug). No summaries, search
--    or embeddings (its words come from SS, which already has them).
--
-- The AI
--  * Its posts carry bot_slug 'ai-insights' and the name "AI Insights": no login, no member row, no
--    API token, so it can't read anything. The actor check allows that bot_slug only in AI Insights
--    and SS, and the guard only for rows the functions below wrote with their record row first.
--  * post_chat_ai_insights_writeup: the day's write-up, at most once per New York day.
--  * post_chat_ai_insights_note: after the write-up, one short note in SS linking to it, at most once
--    per day, never on a day without a write-up. Members' rules in SS are unchanged.
--  * claim_chat_ai_insights_answer / post_chat_ai_insights_answer / fail_chat_ai_insights_answer:
--    the AI answers a member's reply at most once (keyed by that reply), within 20 answers per member
--    and 200 per room per New York day (the caller passes the limits), with one "that's my limit for
--    today" note for a member over the limit.
--
-- Existing functions changed (exact previous bodies are in the rollback):
--   chat_account_has_room, chat_account_room_recipient_eligible, chat_account_rooms,
--   longboard_chat_room_member_count, longboard_chat_room_member_names, longboard_chat_room_members,
--   longboard_chat_room_members_ordered, queue_chat_push.
-- Existing constraints changed: eight room_slug checks and longboard_chat_messages_actor_check.
-- Existing policy changed: "members read chat messages" (admins' list).
-- All read from production and preview on 2026-11-21 (identical on both); the block below stops the
-- migration if any of them changed since.
--
-- Additive: the running app keeps working once this is applied (nothing posts there until the app
-- from #482 ships). Apply it before that app.
-- Rollback: supabase/rollbacks/20261121130000_chat_ai_insights.down.sql

-- Stop if production changed any definition below since it was read (2026-11-21), rather than
-- overwrite a newer one. Each must be exactly what 20261110140000_chat_runner_watch.sql and the later
-- migrations left.
do $$
begin
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='chat_account_has_room') is distinct from '61fe032140a1f7ca62c7979fcdec6587'
  then raise exception 'chat_account_has_room is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='chat_account_room_recipient_eligible') is distinct from '2f57bed492db009358310bcb3a895aed'
  then raise exception 'chat_account_room_recipient_eligible is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='chat_account_rooms') is distinct from 'ce3a7d8377b74547c0ab1fe4e55ce00b'
  then raise exception 'chat_account_rooms is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='longboard_chat_room_member_count') is distinct from '58f371d438809a38f6480d194f36d406'
  then raise exception 'longboard_chat_room_member_count is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='longboard_chat_room_member_names') is distinct from 'd60b5d2410955333616d5292c8a03fc6'
  then raise exception 'longboard_chat_room_member_names is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='longboard_chat_room_members') is distinct from '3420d494e0f44ab1a7620ebdc6f21de8'
  then raise exception 'longboard_chat_room_members is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='longboard_chat_room_members_ordered') is distinct from '259f4317f2e93f2fa3d3fecc031ff5c4'
  then raise exception 'longboard_chat_room_members_ordered is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='queue_chat_push') is distinct from 'e892afc2199a9b6bb05a929ac2ea99f9'
  then raise exception 'queue_chat_push is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.longboard_chat_room_state'::regclass and conname='longboard_chat_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])))$c$)
  then raise exception 'longboard_chat_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_room_reads'::regclass and conname='chat_room_reads_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])))$c$)
  then raise exception 'chat_room_reads_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_favorites'::regclass and conname='chat_favorites_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])))$c$)
  then raise exception 'chat_favorites_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_conversation_pins'::regclass and conname='chat_conversation_pins_room_slug_check') is distinct from md5($c$CHECK (((room_slug IS NULL) OR (room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text]))))$c$)
  then raise exception 'chat_conversation_pins_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_room_notification_levels'::regclass and conname='chat_room_notification_levels_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'gainers'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])))$c$)
  then raise exception 'chat_room_notification_levels_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_login_requests'::regclass and conname='chat_login_requests_return_room_check') is distinct from md5($c$CHECK ((return_room = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])))$c$)
  then raise exception 'chat_login_requests_return_room_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_attachments'::regclass and conname='chat_attachments_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])))$c$)
  then raise exception 'chat_attachments_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.chat_room_mentions'::regclass and conname='chat_room_mentions_room_slug_check') is distinct from md5($c$CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])))$c$)
  then raise exception 'chat_room_mentions_room_slug_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.longboard_chat_messages'::regclass and conname='longboard_chat_messages_actor_check') is distinct from md5($c$CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text)) OR ((guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'longboard'::text))))$c$)
  then raise exception 'longboard_chat_messages_actor_check is not the expected definition: read it and add ai-insights by hand'; end if;
 if (select md5(qual) from pg_policies where schemaname='public' and tablename='longboard_chat_messages' and policyname='members read chat messages') is distinct from md5($q$(EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role = 'admin'::text) AND (longboard_chat_messages.room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text]))) OR (longboard_chat_messages.room_slug = ANY (ARRAY['social'::text, 'gainers'::text, 'whats-new'::text, 'developers'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])) OR ((longboard_chat_messages.room_slug = 'main'::text) AND (EXISTS ( SELECT 1
           FROM user_tags t
          WHERE ((t.user_id = p.id) AND (t.tag = ANY (ARRAY['boardroom-cohort-1'::text, 'boardroom-cohort-2'::text]))))))))))$q$)
  then raise exception 'the "members read chat messages" policy is not the expected definition'; end if;
end $$;

-- The room. Each check is the current production definition with only 'ai-insights' added (the
-- actor check: one clause added at the end, the AI's own bot_slug in AI Insights and SS only).
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text])));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text])));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text])));
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check CHECK (((room_slug IS NULL) OR (room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text]))));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'gainers'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text])));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check CHECK ((return_room = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text])));
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text, 'ai-insights'::text])));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text, 'ai-insights'::text])));
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text)) OR ((guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'longboard'::text)) OR ((room_slug = ANY (ARRAY['ai-insights'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'ai-insights'::text))));

insert into public.longboard_chat_room_state(id,room_slug) values(15,'ai-insights');

-- Current production definition with 'ai-insights' in the admins' list only: members read it through
-- the server, after the same check as SS.
alter policy "members read chat messages" on public.longboard_chat_messages
using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role = 'admin'::text) AND (longboard_chat_messages.room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text]))) OR (longboard_chat_messages.room_slug = ANY (ARRAY['social'::text, 'gainers'::text, 'whats-new'::text, 'developers'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])) OR ((longboard_chat_messages.room_slug = 'main'::text) AND (EXISTS ( SELECT 1
           FROM user_tags t
          WHERE ((t.user_id = p.id) AND (t.tag = ANY (ARRAY['boardroom-cohort-1'::text, 'boardroom-cohort-2'::text])))))))))));

-- Current production definition (2026-11-21) with only 'ai-insights' added (the room list, and the SS rule: mastermind members).
CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','club','runner-watch') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
  -- #384: Booker Stock Club members. Read only when the rules above said no.
  or (p_room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
  -- #386: Booker Stock Club room: the club-room entitlement, or the Gainers rule (also the 'gainers'
  -- entitlement), so every current Gainers member keeps it.
  or (p_room='club' and (public.member_account_has_entitlement(p_account,'club-room') or public.member_account_has_entitlement(p_account,'gainers')))
 when p_room in ('shortscout','ss-announcements','ss-recordings','ai-insights') then exists(select 1 from tier where value='mastermind')
 else false end
 );
end
$function$;

-- Current production definition (2026-11-21) with only 'ai-insights' added (the room list, and the SS rule: mastermind members).
CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','club','runner-watch') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
  -- #384: Booker Stock Club members.
  or (p_room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
  -- #386: Booker Stock Club room: the club-room entitlement, or the Gainers rule (also the 'gainers'
  -- entitlement), so every current Gainers member keeps it.
  or (p_room='club' and (public.member_account_has_entitlement(p_account,'club-room') or public.member_account_has_entitlement(p_account,'gainers')))
 when p_room in ('shortscout','ss-announcements','ss-recordings','ai-insights') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current production definition (2026-11-21) with only 'ai-insights' added (the room list, and the SS rule: mastermind members).
CREATE OR REPLACE FUNCTION public.chat_account_rooms(p_account uuid, p_rooms text[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 -- The rooms of p_rooms that chat_account_has_room(p_account, room) allows, in order. The same rule
 -- as chat_account_has_room; each fact is read once, and only if a room needs it.
 return (
 with tier as materialized (select public.chat_shortscout_identity(p_account)->>'membership_level' value),
 bot as materialized (select b.allowed_rooms from public.chat_bot_accounts b where b.account_id=p_account),
 admin as materialized (select exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') yes),
 cohort as materialized (select exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')) yes),
 profile as materialized (select exists(select 1 from public.profiles where id=p_account) yes)
 select coalesce(array(select u.room from unnest(p_rooms) with ordinality u(room,ord) where case
  when u.room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') or u.room is null then false
  -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
  when u.room='admins' then not exists(select 1 from bot) and (select yes from admin)
  -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
  when exists(select 1 from bot) then exists(select 1 from bot where u.room=any(bot.allowed_rooms))
  when (select yes from admin) then true
  when u.room in ('main','lb-announcements','lb-recordings') then (select yes from cohort)
  when u.room in ('social','gainers','whats-new','developers','lb-review','club','runner-watch') then (select yes from profile)
   or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
   -- #384: Booker Stock Club members. Read only when the rules above said no.
   or (u.room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
   -- #386: the club-room entitlement, or the Gainers rule (also the 'gainers' entitlement).
   or (u.room='club' and (public.member_account_has_entitlement(p_account,'club-room') or public.member_account_has_entitlement(p_account,'gainers')))
  when u.room in ('shortscout','ss-announcements','ss-recordings','ai-insights') then exists(select 1 from tier where value='mastermind')
  else false end
  order by u.ord),'{}'::text[])
 );
end
$function$;

-- Current production definition (2026-11-21) with only 'ai-insights' added.
CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Current production definition (2026-11-21) with only 'ai-insights' added.
CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') then raise exception 'invalid_room'; end if;
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

-- Current production definition (2026-11-21) with only 'ai-insights' added.
CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') then raise exception 'invalid_room'; end if;
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

-- Current production definition (2026-11-21) with only 'ai-insights' added.
CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins','ai-insights') then raise exception 'invalid_room'; end if;
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

-- Current production definition (2026-11-21) with only 'ai-insights' added.
CREATE OR REPLACE FUNCTION public.queue_chat_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  if new.room_slug not in ('main','social','shortscout','developers','lb-review','runner-watch','admins','ai-insights') then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id
   and not exists(select 1 from public.chat_room_notification_levels p where p.account_id=new.account_id and p.room_slug=new.room_slug and p.level='muted')
  on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $function$;

-- The record of what was posted. RLS on, no policies, service role only (the cron route, the
-- chat send path's answer step and the admin dry run all use the service role).
-- chat_ai_insights_days: one row per New York day that got a write-up, and its note in SS.
create table public.chat_ai_insights_days(
 day date primary key,
 message_id uuid not null unique,
 note_message_id uuid unique,
 message_count integer not null check(message_count between 0 and 100000),
 model text not null check(char_length(model) between 1 and 80),
 posted_at timestamptz not null default now(),
 note_posted_at timestamptz
);
-- chat_ai_insights_answers: one row per member reply the AI looked at, keyed by that reply, so each
-- reply is answered at most once. kind 'answer' (an answer), 'limit_note' (the one "that's my limit
-- for today" note a member gets) or 'skipped' (over a limit, nothing posted).
create table public.chat_ai_insights_answers(
 trigger_message_id uuid primary key,
 day date not null,
 member_id uuid not null,
 kind text not null check(kind in ('answer','limit_note','skipped')),
 status text not null check(status in ('pending','posted','failed','skipped')),
 reply_message_id uuid unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index chat_ai_insights_answers_day on public.chat_ai_insights_answers(day,member_id);
alter table public.chat_ai_insights_days enable row level security;
alter table public.chat_ai_insights_answers enable row level security;
revoke all on public.chat_ai_insights_days,public.chat_ai_insights_answers from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_ai_insights_days,public.chat_ai_insights_answers to service_role;

-- Who writes what in AI Insights, and the AI's one note a day in SS.
--  * The AI (bot_slug 'ai-insights', "AI Insights"): only rows the functions below wrote, each with
--    its row in the record first: the day's write-up (a new post), an answer (a reply), or the SS
--    note (a new post in shortscout). Never a member id, never files; its posts never change
--    (an admin can still delete one: that removes the row).
--  * Members: replies only, through the Reply button. A new post needs a chat admin's own post
--    (profile role exactly 'admin'). Never an agent's post.
--  * Longboard Bot announcements (#413) can start a post here, as in every room.
--  * Rows never move into or out of AI Insights.
create or replace function public.enforce_chat_ai_insights_post()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
 if tg_op='UPDATE' and (old.room_slug='ai-insights' or old.bot_slug='ai-insights')
  and (old.room_slug<>new.room_slug or old.bot_slug is distinct from new.bot_slug) then raise exception 'ai_insights_read_only'; end if;
 if new.bot_slug='ai-insights' then
  if tg_op='UPDATE' then
   if new.body is distinct from old.body or new.author_label is distinct from old.author_label
    or new.attachment_ids is distinct from old.attachment_ids then raise exception 'ai_insights_read_only'; end if;
   return new;
  end if;
  if new.author_label<>'AI Insights' or new.member_id is not null or new.guest_id is not null or new.agent_id is not null
   or cardinality(new.attachment_ids)>0 then raise exception 'ai_insights_read_only'; end if;
  if new.room_slug='ai-insights' and new.reply_to_id is null
   and exists(select 1 from public.chat_ai_insights_days d where d.message_id=new.id) then return new; end if;
  if new.room_slug='ai-insights' and new.reply_to_id is not null
   and exists(select 1 from public.chat_ai_insights_answers a where a.reply_message_id=new.id and a.status='posted') then return new; end if;
  if new.room_slug='shortscout' and new.reply_to_id is null
   and exists(select 1 from public.chat_ai_insights_days d where d.note_message_id=new.id) then return new; end if;
  raise exception 'ai_insights_read_only';
 end if;
 if new.room_slug='ai-insights' and tg_op='INSERT' then
  if new.guest_id is null then
   if new.bot_slug='longboard' and new.reply_to_id is null then return new; end if;
   raise exception 'ai_insights_read_only';
  end if;
  if new.bot_slug is not null or new.agent_id is not null or coalesce(current_setting('chat.agent_id',true),'')<>''
  then raise exception 'ai_insights_read_only'; end if;
  if new.reply_to_id is null and not (new.member_id is not null and new.member_id=new.guest_id and exists(
    select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
    where m.id=new.member_id and p.role='admin'))
  then raise exception 'ai_insights_read_only'; end if;
 end if;
 return new;
end $function$;
create trigger chat_ai_insights_post_guard before insert or update on public.longboard_chat_messages
 for each row execute function public.enforce_chat_ai_insights_post();

-- The day's write-up. Under a per-day lock, so a second run (or a retry) never posts twice.
create or replace function public.post_chat_ai_insights_writeup(p_day date, p_body text, p_message_count integer, p_model text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare d public.chat_ai_insights_days; post_id uuid:=gen_random_uuid(); result public.longboard_chat_messages;
begin
 if p_day is null or p_body is null or char_length(btrim(p_body)) not between 1 and 10000
  or p_message_count is null or p_message_count not between 0 and 100000 or p_model is null or char_length(p_model) not between 1 and 80
 then raise exception 'invalid_ai_insights_post'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_ai_insights_day:'||p_day::text,0));
 select * into d from public.chat_ai_insights_days where day=p_day;
 if found then return jsonb_build_object('status','duplicate','messageId',d.message_id,'noteMessageId',d.note_message_id); end if;
 insert into public.chat_ai_insights_days(day,message_id,message_count,model) values(p_day,post_id,p_message_count,p_model);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(post_id,'ai-insights','AI Insights',btrim(p_body),'ai-insights') returning * into result;
 return jsonb_build_object('status','posted','messageId',post_id,'message',to_jsonb(result));
end $function$;
revoke all on function public.post_chat_ai_insights_writeup(date,text,integer,text) from public,anon,authenticated;
grant execute on function public.post_chat_ai_insights_writeup(date,text,integer,text) to service_role;

-- The note in SS, once the write-up is posted. At most once a day, never without a write-up.
create or replace function public.post_chat_ai_insights_note(p_day date, p_body text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare d public.chat_ai_insights_days; note_id uuid:=gen_random_uuid(); result public.longboard_chat_messages;
begin
 if p_day is null or p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then raise exception 'invalid_ai_insights_note'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_ai_insights_day:'||p_day::text,0));
 select * into d from public.chat_ai_insights_days where day=p_day for update;
 if not found then return jsonb_build_object('status','no_writeup'); end if;
 if d.note_message_id is not null then return jsonb_build_object('status','duplicate','messageId',d.note_message_id); end if;
 update public.chat_ai_insights_days set note_message_id=note_id,note_posted_at=now() where day=p_day;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'shortscout','AI Insights',btrim(p_body),'ai-insights') returning * into result;
 return jsonb_build_object('status','posted','messageId',note_id,'message',to_jsonb(result));
end $function$;
revoke all on function public.post_chat_ai_insights_note(date,text) from public,anon,authenticated;
grant execute on function public.post_chat_ai_insights_note(date,text) to service_role;

-- Before the AI answers a member's reply: one row per reply (a second call says 'duplicate'), and the
-- limits for that New York day, under one lock per day. The room limit counts answers and limit
-- notes; a member's limit counts answers. A member over the limit gets one limit note, then nothing.
create or replace function public.claim_chat_ai_insights_answer(p_trigger uuid, p_member_cap integer, p_room_cap integer)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare m public.longboard_chat_messages; d date; used integer; room_used integer; outcome text;
begin
 if p_trigger is null or p_member_cap is null or p_member_cap not between 1 and 1000 or p_room_cap is null or p_room_cap not between 1 and 10000
 then raise exception 'invalid_ai_insights_claim'; end if;
 select * into m from public.longboard_chat_messages where id=p_trigger;
 if not found or m.room_slug<>'ai-insights' or m.guest_id is null or m.member_id is null or m.bot_slug is not null
  or m.agent_id is not null or m.reply_to_id is null or m.deleted_at is not null or m.removed
 then return jsonb_build_object('status','not_eligible'); end if;
 d:=(m.created_at at time zone 'America/New_York')::date;
 perform pg_advisory_xact_lock(hashtextextended('chat_ai_insights_answers:'||d::text,0));
 if exists(select 1 from public.chat_ai_insights_answers a where a.trigger_message_id=p_trigger) then
  return jsonb_build_object('status','duplicate');
 end if;
 select count(*) into room_used from public.chat_ai_insights_answers a where a.day=d and a.kind in ('answer','limit_note');
 select count(*) into used from public.chat_ai_insights_answers a where a.day=d and a.member_id=m.member_id and a.kind='answer';
 if room_used>=p_room_cap then outcome:='room_capped';
 elsif used>=p_member_cap then
  outcome:=case when exists(select 1 from public.chat_ai_insights_answers a where a.day=d and a.member_id=m.member_id and a.kind='limit_note')
   then 'capped' else 'limit_note' end;
 else outcome:='answer';
 end if;
 insert into public.chat_ai_insights_answers(trigger_message_id,day,member_id,kind,status)
  values(p_trigger,d,m.member_id,case when outcome in ('answer','limit_note') then outcome else 'skipped' end,
   case when outcome in ('answer','limit_note') then 'pending' else 'skipped' end);
 return jsonb_build_object('status',outcome,'day',d,'rootId',m.reply_to_id,'memberId',m.member_id);
end $function$;
revoke all on function public.claim_chat_ai_insights_answer(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_chat_ai_insights_answer(uuid,integer,integer) to service_role;

-- The answer (or the limit note) for a claimed reply, posted as a reply in the same thread.
create or replace function public.post_chat_ai_insights_answer(p_trigger uuid, p_body text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare a public.chat_ai_insights_answers; m public.longboard_chat_messages; reply_id uuid:=gen_random_uuid(); result public.longboard_chat_messages;
begin
 if p_trigger is null or p_body is null or char_length(btrim(p_body)) not between 1 and 10000 then raise exception 'invalid_ai_insights_answer'; end if;
 select * into a from public.chat_ai_insights_answers where trigger_message_id=p_trigger for update;
 if not found or a.status<>'pending' then return jsonb_build_object('status','not_pending'); end if;
 select * into m from public.longboard_chat_messages where id=p_trigger;
 if not found or m.deleted_at is not null or m.removed or m.room_slug<>'ai-insights' then
  update public.chat_ai_insights_answers set status='failed',updated_at=now() where trigger_message_id=p_trigger;
  return jsonb_build_object('status','trigger_gone');
 end if;
 update public.chat_ai_insights_answers set status='posted',reply_message_id=reply_id,updated_at=now() where trigger_message_id=p_trigger;
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug,reply_to_id)
  values(reply_id,'ai-insights','AI Insights',btrim(p_body),'ai-insights',p_trigger) returning * into result;
 return jsonb_build_object('status','posted','messageId',reply_id,'message',to_jsonb(result));
end $function$;
revoke all on function public.post_chat_ai_insights_answer(uuid,text) from public,anon,authenticated;
grant execute on function public.post_chat_ai_insights_answer(uuid,text) to service_role;

-- A claimed answer that could not be written (the model failed or its numbers didn't check out).
-- It stays answered-once: the reply is never tried again.
create or replace function public.fail_chat_ai_insights_answer(p_trigger uuid)
 returns void
 language sql
 set search_path to ''
as $function$
 update public.chat_ai_insights_answers set status='failed',updated_at=now() where trigger_message_id=p_trigger and status='pending';
$function$;
revoke all on function public.fail_chat_ai_insights_answer(uuid) from public,anon,authenticated;
grant execute on function public.fail_chat_ai_insights_answer(uuid) to service_role;
revoke all on function public.enforce_chat_ai_insights_post() from public,anon,authenticated;
