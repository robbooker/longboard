-- Rollback for 20261121120000_chat_ai_insights.sql (#482 AI Insights).
-- Removes the record, the guard and the functions, the AI Insights room with its messages, reactions,
-- reads, settings, alerts and files, and the AI's notes in SS, and restores every function, constraint
-- and policy to its exact previous definition (production on 2026-11-21). There is no bot account.

drop trigger if exists chat_ai_insights_post_guard on public.longboard_chat_messages;
drop function if exists public.enforce_chat_ai_insights_post();
drop function if exists public.post_chat_ai_insights_writeup(date,text,integer,text);
drop function if exists public.post_chat_ai_insights_note(date,text);
drop function if exists public.claim_chat_ai_insights_answer(uuid,integer,integer);
drop function if exists public.post_chat_ai_insights_answer(uuid,text);
drop function if exists public.fail_chat_ai_insights_answer(uuid);
drop table if exists public.chat_ai_insights_answers;
drop table if exists public.chat_ai_insights_days;

-- Room rows first, so the restored constraints validate. Reactions, choices, pins, attachments,
-- embeddings and notifications cascade from the messages. The AI's notes in SS go too.
delete from public.longboard_chat_messages where bot_slug='ai-insights';
delete from public.chat_push_jobs j where j.kind='room' and exists(select 1 from public.chat_room_mentions n where n.id=j.source_id and n.room_slug='ai-insights');
delete from public.chat_room_mentions where room_slug='ai-insights';
delete from public.chat_message_actions where room_slug='ai-insights';
delete from public.longboard_chat_messages where room_slug='ai-insights';
delete from public.chat_room_reads where room_slug='ai-insights';
delete from public.chat_favorites where room_slug='ai-insights';
delete from public.chat_conversation_pins where room_slug='ai-insights';
delete from public.chat_room_notification_levels where room_slug='ai-insights';
delete from public.chat_login_requests where return_room='ai-insights';
delete from public.chat_attachments where room_slug='ai-insights';
delete from public.chat_room_message_pins where room_slug='ai-insights';
delete from public.longboard_chat_admin_events where room_slug='ai-insights';
delete from public.longboard_chat_room_event_tombstones where room_slug='ai-insights';
delete from public.longboard_chat_room_reaction_events where room_slug='ai-insights';
delete from public.longboard_chat_room_event_heads where room_slug='ai-insights';
delete from public.longboard_chat_room_state where room_slug='ai-insights';

-- The deletes above leave deferred checks waiting, and the message table's check changes below.
set constraints all immediate;

alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])));
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check CHECK (((room_slug IS NULL) OR (room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text]))));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'gainers'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check CHECK ((return_room = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])));
alter table public.chat_attachments drop constraint chat_attachments_room_slug_check;
alter table public.chat_attachments add constraint chat_attachments_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])));
alter table public.chat_room_mentions drop constraint chat_room_mentions_room_slug_check;
alter table public.chat_room_mentions add constraint chat_room_mentions_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text, 'club'::text])));
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text)) OR ((guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'longboard'::text))));

alter policy "members read chat messages" on public.longboard_chat_messages
using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role = 'admin'::text) AND (longboard_chat_messages.room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text]))) OR (longboard_chat_messages.room_slug = ANY (ARRAY['social'::text, 'gainers'::text, 'whats-new'::text, 'developers'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])) OR ((longboard_chat_messages.room_slug = 'main'::text) AND (EXISTS ( SELECT 1
           FROM user_tags t
          WHERE ((t.user_id = p.id) AND (t.tag = ANY (ARRAY['boardroom-cohort-1'::text, 'boardroom-cohort-2'::text])))))))))));

-- Previous definition (production, 2026-11-21).
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
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') or p_room is null then false
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
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end
 );
end
$function$;

-- Previous definition (production, 2026-11-21).
CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') or p_room is null then false
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
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Previous definition (production, 2026-11-21).
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
  when u.room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') or u.room is null then false
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
  when u.room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
  else false end
  order by u.ord),'{}'::text[])
 );
end
$function$;

-- Previous definition (production, 2026-11-21).
CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Previous definition (production, 2026-11-21).
CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Previous definition (production, 2026-11-21).
CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Previous definition (production, 2026-11-21).
CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','runner-watch','admins') then raise exception 'invalid_room'; end if;
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

-- Previous definition (production, 2026-11-21).
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
