-- Rollback for 20261127130000_chat_webinars_room.sql (#537 Webinars).
-- Roll the app back first (the app from #537 offers the room and asks for copies; the app before it
-- does neither). Then this removes the Webinars room and the Booker Stock Club recordings room with their messages, reactions, reads, settings,
-- alerts and files, the copies' record and function, and restores every function, constraint and
-- policy to its exact previous definition. The copies already posted in other rooms stay as they
-- read (they are ordinary Longboard Bot posts); nothing else in any other room is touched.

drop function if exists public.chat_stage_broadcast_copy_post(uuid,text[],uuid[],text);

-- Room rows first, so the restored constraints validate. Reactions, choices, pins, attachments,
-- embeddings and notifications cascade from the messages.
delete from public.chat_push_jobs j where j.kind='room' and exists(select 1 from public.chat_room_mentions n where n.id=j.source_id and n.room_slug in ('webinars','club-recordings'));
delete from public.chat_room_mentions where room_slug in ('webinars','club-recordings');
delete from public.chat_message_actions where room_slug in ('webinars','club-recordings');
delete from public.chat_stage_broadcasts where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_messages where room_slug in ('webinars','club-recordings');
delete from public.chat_room_reads where room_slug in ('webinars','club-recordings');
delete from public.chat_favorites where room_slug in ('webinars','club-recordings');
delete from public.chat_conversation_pins where room_slug in ('webinars','club-recordings');
delete from public.chat_room_notification_levels where room_slug in ('webinars','club-recordings');
delete from public.chat_login_requests where return_room in ('webinars','club-recordings');
delete from public.chat_attachments where room_slug in ('webinars','club-recordings');
delete from public.chat_room_message_pins where room_slug in ('webinars','club-recordings');
delete from public.chat_room_summary_cache where room_slug in ('webinars','club-recordings');
delete from public.chat_summary_deliveries where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_admin_events where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_room_event_tombstones where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_room_reaction_events where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_room_event_heads where room_slug in ('webinars','club-recordings');
delete from public.longboard_chat_room_state where room_slug in ('webinars','club-recordings');

-- The deletes above leave deferred checks waiting, and the checks change below.
set constraints all immediate;

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
alter table public.chat_room_summary_cache drop constraint chat_room_summary_cache_room_slug_check;
alter table public.chat_room_summary_cache add constraint chat_room_summary_cache_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])));
alter table public.chat_summary_deliveries drop constraint chat_summary_deliveries_room_slug_check;
alter table public.chat_summary_deliveries add constraint chat_summary_deliveries_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'runner-watch'::text])));

alter policy "members read chat messages" on public.longboard_chat_messages
 using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role = 'admin'::text) AND (longboard_chat_messages.room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text, 'ai-insights'::text]))) OR (longboard_chat_messages.room_slug = ANY (ARRAY['social'::text, 'gainers'::text, 'whats-new'::text, 'developers'::text, 'lb-review'::text, 'club'::text, 'runner-watch'::text])) OR ((longboard_chat_messages.room_slug = 'main'::text) AND (EXISTS ( SELECT 1
           FROM user_tags t
          WHERE ((t.user_id = p.id) AND (t.tag = ANY (ARRAY['boardroom-cohort-1'::text, 'boardroom-cohort-2'::text])))))))))));

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
$function$
;

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
$function$
;

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
$function$
;

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
end $function$
;

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
end $function$
;

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
end $function$
;

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
end $function$
;

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
end $function$
;

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
$function$
;

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
$function$
;

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
end; $function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_chat_club_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare parent public.longboard_chat_messages;
begin
 -- #524: the one bot post in the club whose words may change: Longboard Bot's live-video notice (a
 -- row of chat_stage_broadcasts for the club), rewritten by public.chat_stage_notice_rewrite, which
 -- names it in a setting for its own transaction. Its words change; who posted it, where, when,
 -- under what name, as a reply to what, with what files, and whether it is deleted may not.
 if tg_op='UPDATE' and old.room_slug='club' and new.room_slug='club' and old.guest_id is null
  and old.bot_slug='longboard' and coalesce(current_setting('chat.stage_notice',true),'')=old.id::text
  and exists(select 1 from public.chat_stage_broadcasts b where b.notice_id=old.id and b.room_slug='club')
  and new.id=old.id and new.guest_id is null and new.member_id is null and new.agent_id is null
  and new.bot_slug='longboard' and new.author_label=old.author_label
  and new.reply_to_id is not distinct from old.reply_to_id and new.attachment_ids=old.attachment_ids
  and new.created_at=old.created_at and new.deleted_at is not distinct from old.deleted_at
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
end $function$
;

CREATE OR REPLACE FUNCTION public.notify_chat_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.room_slug not in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings') then return new; end if;
 insert into public.chat_room_mentions(account_id,message_id,room_slug)
 select a.id,new.id,new.room_slug from public.chat_accounts a
 where public.chat_account_room_recipient_eligible(a.id,new.room_slug)
 on conflict(account_id,message_id) do nothing;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.enforce_chat_announcement_writer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target_room text; target_member uuid;
begin
 if tg_table_name='longboard_chat_reactions' then
  select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
  target_member:=new.guest_id;
 else target_room:=new.room_slug; target_member:=new.member_id;
  -- #302: automatic What's New notes (checked against their ledger by enforce_chat_whats_new_note).
  -- Also the trigger on chat_attachments, whose rows have no bot_slug: check the table first.
  if tg_table_name='longboard_chat_messages' then
   if new.room_slug='whats-new' and new.bot_slug='whats-new' and new.member_id is null then return new; end if;
   -- #413: Longboard Bot announcements (only the service role writes bot rows).
   if new.bot_slug='longboard' and new.member_id is null and new.guest_id is null then return new; end if;
  end if;
  -- #443: pictures for the automatic notes (only the service role writes chat_attachments).
  if tg_table_name='chat_attachments' then
   if new.room_slug='whats-new' and new.member_id is null and new.whats_new_pr is not null then return new; end if;
  end if;
 end if;
 if target_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'announcement_admin_only'; end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.change_chat_message(p_actor uuid, p_message uuid, p_room text, p_action text, p_body text DEFAULT NULL::text, p_expected_body text DEFAULT NULL::text, p_admin boolean DEFAULT false, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.longboard_chat_messages; ancestor public.longboard_chat_messages; own boolean; moderator boolean; parent_id uuid; note_edit boolean;
begin
 if p_action not in ('edit','delete') or p_action is null then raise exception 'invalid_action'; end if;
 if p_room in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') and not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'message_forbidden'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 perform public.lock_chat_message_ancestors(p_message,p_room);
 select * into m from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 if not found then raise exception 'message_not_found'; end if;
 own:=m.member_id is not null and exists(select 1 from public.longboard_chat_members where id=m.member_id and user_id=p_actor);
 moderator:=p_admin and exists(select 1 from public.profiles where id=p_actor and role='admin');
 -- #302: admins can also edit the automatic What's New notes (Booker Chat Updates).
 note_edit:=p_action='edit' and moderator and p_room='whats-new' and m.bot_slug='whats-new' and m.member_id is null;
 if not own and not note_edit and not (p_action='delete' and moderator) then raise exception 'message_forbidden'; end if;
 -- Existing administrator moderation stays separate from members' own-message actions.
 if not own and not note_edit then
  delete from public.longboard_chat_messages where id=m.id;
  insert into public.chat_message_actions(message_id,room_slug,actor_id,action) values(m.id,m.room_slug,p_actor,'admin_delete');
  -- Moderation can remove the final child of a member-deleted parent too.
  parent_id:=m.reply_to_id;
  while parent_id is not null loop
   select * into ancestor from public.longboard_chat_messages where id=parent_id for update;
   exit when not found or ancestor.deleted_at is null or ancestor.removed or exists(select 1 from public.longboard_chat_messages where reply_to_id=ancestor.id and not removed);
   update public.longboard_chat_messages set removed=true,revision=revision+1 where id=ancestor.id;
   parent_id:=ancestor.reply_to_id;
  end loop;
  return jsonb_build_object('deletedId',m.id,'message',null);
 end if;
 if p_action='delete' and m.deleted_at is not null then return jsonb_build_object('deletedId',m.id,'message',to_jsonb(m)); end if;
 if m.removed then raise exception 'message_not_found'; end if;
 if p_expected_revision is not null and m.revision<>p_expected_revision then raise exception 'message_changed'; end if;
 if p_action='edit' then
  if m.bot_slug is not null and not note_edit then raise exception 'message_forbidden'; end if;
  if not exists(select 1 from public.longboard_chat_room_state where room_slug=p_room and is_open) then raise exception 'chat_paused'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 10000 then raise exception 'invalid_message'; end if;
  if p_expected_body is null or m.body<>p_expected_body or (m.deleted_at is not null and p_expected_revision is distinct from m.revision) then raise exception 'message_changed'; end if;
  if m.body=btrim(p_body) and m.deleted_at is null then return to_jsonb(m); end if;
  update public.longboard_chat_messages set body=btrim(p_body),edited_at=clock_timestamp(),deleted_at=null,revision=revision+1 where id=m.id returning * into m;
 else
  update public.longboard_chat_messages set body='Message deleted',deleted_at=clock_timestamp(),attachment_ids='{}',buddy_status=null,
   removed=not exists(select 1 from public.longboard_chat_messages r where r.reply_to_id=m.id and not r.removed),revision=revision+1
   where id=m.id returning * into m;
  delete from public.chat_attachments where room_message_id=m.id;
  delete from public.longboard_chat_reactions where message_id=m.id;
  delete from public.chat_message_reaction_choices where room_message_id=m.id;
  delete from public.chat_room_mentions where message_id=m.id;
  delete from public.chat_buddy_jobs where message_id=m.id;
  -- A deleted ancestor stops occupying space when its last surviving reply disappears.
  parent_id:=m.reply_to_id;
  while m.removed and parent_id is not null loop
   select * into ancestor from public.longboard_chat_messages where id=parent_id for update;
   exit when not found or ancestor.deleted_at is null or ancestor.removed or exists(select 1 from public.longboard_chat_messages where reply_to_id=ancestor.id and not removed);
   update public.longboard_chat_messages set removed=true,revision=revision+1 where id=ancestor.id;
   parent_id:=ancestor.reply_to_id;
  end loop;
 end if;
 insert into public.chat_message_actions(message_id,room_slug,actor_id,action) values(m.id,m.room_slug,p_actor,p_action);
 if p_action='delete' then return jsonb_build_object('deletedId',m.id,'message',to_jsonb(m)); end if;
 return to_jsonb(m);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_chat_room_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare person record; recipients uuid[]:='{}'; recipient uuid;
begin
 -- #302: What's New never alerts anyone, not even for an @name in an admin note.
 if new.room_slug in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') then return new; end if;
 if new.member_id is not null then
  for person in select distinct m.id,m.user_id from chat_message_tags t join longboard_chat_members m on m.id=t.member_id where t.message_id=new.id loop
   if person.id<>new.member_id and public.chat_account_room_recipient_eligible(person.user_id,new.room_slug) and not exists(select 1 from longboard_chat_blocks b where (b.blocker_id=person.id and b.blocked_id=new.member_id) or (b.blocked_id=person.id and b.blocker_id=new.member_id)) then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and category='mention' and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_activity_counts(actor uuid, rooms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.chat_activity_inbox(actor uuid, rooms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
 -- HEALTH-2026-11-09-1: one access call for every requested room plus Social (DMs need Social
 -- whether or not it was asked for). Social, when it was not asked for, never reaches a room list:
 -- every room read below also requires the room to be in rooms.
 with access as materialized (
  select allowed_rooms,'social'=any(allowed_rooms) social_ok
  from (select public.chat_account_rooms(actor,case when 'social'=any(rooms) then rooms else array_append(rooms,'social') end) allowed_rooms) checked
 ),
 me as (select id from public.longboard_chat_members where user_id=actor),
 -- Members this person blocked or is blocked by, read once (was one blocks probe per listed row).
 blocked as materialized (
  select coalesce(array_agg(case when b.blocker_id=me.id then b.blocked_id else b.blocker_id end),'{}'::uuid[]) ids
  from public.longboard_chat_blocks b join me on b.blocker_id=me.id or b.blocked_id=me.id
 ),
 -- ROOM-NOTIFY: one primary-key read of this person's room levels. "quiet_mentions" leaves the
 -- bell: muted rooms, and mentions-only announcement/recordings rooms (their rows are a post
 -- for everyone, never a personal mention). "quiet_reactions" also drops mentions-only rooms.
 levels as materialized (
  select coalesce(jsonb_object_agg(p.room_slug,p.level),'{}'::jsonb) room_levels,
   coalesce(array_agg(p.room_slug) filter (where p.level='muted' or (p.level='mentions' and p.room_slug in ('lb-announcements','ss-announcements','lb-recordings','ss-recordings'))),'{}'::text[]) quiet_mentions,
   coalesce(array_agg(p.room_slug) filter (where p.level in ('muted','mentions')),'{}'::text[]) quiet_reactions
  from public.chat_room_notification_levels p where p.account_id=actor and p.room_slug=any(rooms)
 ),
 -- HEALTH-2026-11-09-1: the unread mentions, counted per room in one pass. Only the room and number
 -- are read (no author, no text), room by room from the partial index on unread rows (the generic
 -- plan used to read every alert the person ever had and drop the read ones). Each room once,
 -- even if rooms names it twice. A reply-to message is read only when someone is blocked.
 unread_mention_rooms as materialized (
  select r.room,count(*) total,max(n.seq) latest
  from (select distinct a.room from unnest((select allowed_rooms from access)::text[]) a(room)
   where a.room=any(rooms) and a.room<>all((select quiet_mentions from levels)::text[])) r
  join public.chat_room_mentions n on n.account_id=actor and n.room_slug=r.room and n.read_at is null
  join public.longboard_chat_messages m on m.id=n.message_id
  where m.deleted_at is null and not m.removed
   and not coalesce(m.member_id=any((select ids from blocked)::uuid[]),false)
   and (cardinality((select ids from blocked)::uuid[])=0 or not exists(select 1 from public.longboard_chat_messages parent
    where parent.id=n.thread_root_id and parent.member_id=any((select ids from blocked)::uuid[])))
  group by r.room
 ),
 -- HEALTH-2026-11-02-1: the newest 50, walking this person's alerts newest first and stopping at
 -- 50 that qualify. OFFSET 0 keeps the message checks above the ordered read, so a busy person no
 -- longer pays for every alert they ever had. seq is unique: the same 50 rows as before.
 listed_mentions as (
  select n.id,n.seq,n.message_id,n.room_slug,n.category,n.thread_root_id,n.read_at,n.created_at,left(coalesce(sender.display_name,m.author_label),100) author_label,m.body,
   case when parent.deleted_at is null then parent.body else null end parent_body
  from (
   select x.* from public.chat_room_mentions x
   where x.account_id=actor and x.room_slug=any(rooms)
    and x.room_slug=any((select allowed_rooms from access)::text[])
    and x.room_slug<>all((select quiet_mentions from levels)::text[])
   order by x.seq desc offset 0
  ) n join public.longboard_chat_messages m on m.id=n.message_id
  left join public.longboard_chat_members sender on sender.id=m.member_id and m.bot_slug is null
  left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
  where m.deleted_at is null and not m.removed
   and not coalesce(m.member_id=any((select ids from blocked)::uuid[]),false)
   and not coalesce(parent.member_id=any((select ids from blocked)::uuid[]),false)
  order by n.seq desc limit 50
 ), conversations as (
  select c.*,me.id as my_id,left(other.display_name,100) as other_name,other.user_id as other_account,
   case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end as read_seq
  from me join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
  join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
  where c.status<>'declined' and (select social_ok from access)
   and other.id<>all((select ids from blocked)::uuid[])
 ), dm_counts as (
  select c.id,c.other_name,c.status,d.unread,d.through_seq,d.latest_at
  from conversations c cross join lateral (
   select count(*) unread,max(d.seq) through_seq,max(d.created_at) latest_at
   from public.longboard_chat_direct_messages d
   where d.conversation_id=c.id and d.sender_id<>c.my_id and d.seq>c.read_seq and d.deleted_at is null
  ) d where d.unread>0
 ), latest_incoming as (
  select c.id,c.other_name,c.status,d.seq,d.created_at,d.id message_id,d.body,d.attachment_ids from conversations c
  cross join lateral (
   select d.seq,d.created_at,d.id,d.body,d.attachment_ids from public.longboard_chat_direct_messages d
   where d.conversation_id=c.id and d.sender_id<>c.my_id and d.deleted_at is null
   order by d.seq desc limit 1
  ) d
 ), dms as (
  select c.id,c.other_name,c.status,coalesce(unread.unread,0) unread,c.seq through_seq,c.created_at latest_at,c.message_id,left(case when c.body='' and cardinality(c.attachment_ids)>0 then 'Shared an attachment' else c.body end,240) preview
  from latest_incoming c
  left join dm_counts unread on unread.id=c.id
 ), pinned_candidates as materialized (
  -- HEALTH-2026-10-19-3: join the pins first so the recipient check below runs only for pinned
  -- conversations (it used to run for every conversation before the pin join).
  select p.id pin_id,c.id,c.other_account
  from public.chat_conversation_pins p join conversations c on c.id=p.conversation_id
  where p.account_id=actor and c.status='accepted'
 ), pinned_dms as (
  -- Same actor, participant, accepted-state, blocks and recipient policy as chat_pins.
  -- Join before the preview limit; zero is explicit, never inferred from a missing preview.
  select c.id,coalesce(d.unread,0) unread
  from pinned_candidates c
  left join dm_counts d on d.id=c.id
  where public.chat_account_room_recipient_eligible(c.other_account,'social')
  order by c.pin_id limit 50
 ), -- HEALTH-2026-11-02-1: the newest 50 of each kind, walking newest first and stopping at 50. The
 -- newest 50 overall are among them (seq is unique), so the list is the same rows as before.
 reactions as materialized (
  select * from (
   (select n.id,n.seq,'room'::text kind,m.room_slug room,null::uuid conversation_id,m.id message_id,
     left(reactor.display_name,100) author,n.emoji,left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240) preview,n.created_at,n.read_at is not null as read
    from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.room_message_id is not null order by x.seq desc offset 0) n
    join me on true
    join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
    join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
    where m.deleted_at is null and not m.removed
     and m.room_slug=any(rooms) and m.room_slug=any((select allowed_rooms from access)::text[])
     and m.room_slug<>all((select quiet_reactions from levels)::text[])
     and reactor.id<>all((select ids from blocked)::uuid[])
    order by n.seq desc limit 50)
   union all
   (select n.id,n.seq,'dm'::text,null::text,c.id,m.id,left(reactor.display_name,100),n.emoji,
     left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240),n.created_at,n.read_at is not null
    from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.dm_message_id is not null order by x.seq desc offset 0) n
    join me on true
    join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
    join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
    join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
    where m.deleted_at is null and c.status='accepted'
     and (select social_ok from access)
     and reactor.id<>all((select ids from blocked)::uuid[])
    order by n.seq desc limit 50)
  ) both_kinds order by seq desc limit 50
 ),
 -- The unread count and cursor: only unread rows, from the partial index on them.
 -- HEALTH-2026-11-09-1: the reactor's member row is not read here. reactor_member_id is NOT NULL
 -- with a foreign key to longboard_chat_members (ON DELETE CASCADE), so that join never dropped a
 -- row; the blocks and participant checks use the same id.
 unread_reactions as materialized (
  select n.seq
  from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.read_at is null and x.room_message_id is not null offset 0) n join me on true
  join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
  where m.deleted_at is null and not m.removed
   and m.room_slug=any(rooms) and m.room_slug=any((select allowed_rooms from access)::text[])
   and m.room_slug<>all((select quiet_reactions from levels)::text[])
   and n.reactor_member_id<>all((select ids from blocked)::uuid[])
  union all
  select n.seq
  from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.read_at is null and x.dm_message_id is not null offset 0) n join me on true
  join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
  join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
  where m.deleted_at is null and c.status='accepted' and n.reactor_member_id in(c.requester_id,c.recipient_id)
   and (select social_ok from access)
   and n.reactor_member_id<>all((select ids from blocked)::uuid[])
 )
 select jsonb_build_object(
  'roomLevels',(select room_levels from levels),
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,240),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,96),'threadRootId',thread_root_id,'read',read_at is not null) item from listed_mentions) listed),'[]'::jsonb),
  'mentionCount',(select coalesce(sum(total),0)::bigint from unread_mention_rooms),'mentionThrough',coalesce((select max(latest) from unread_mention_rooms),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from unread_mention_rooms),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from unread_mention_rooms),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending','messageId',message_id,'preview',preview,'createdAt',latest_at) item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'pinnedDmUnread',coalesce((select jsonb_object_agg(id,unread) from pinned_dms),'{}'::jsonb),
  'dmCount',coalesce((select sum(unread) from dm_counts),0),'dmThrough',coalesce((select max(through_seq) from dm_counts),0),
  'reactions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_strip_nulls(jsonb_build_object('id',id,'seq',seq,'kind',kind,'room',room,'conversationId',conversation_id,'messageId',message_id,'author',author,'emoji',emoji,'preview',preview,'createdAt',created_at,'read',read)) item from reactions) listed),'[]'::jsonb),
  'reactionCount',(select count(*) from unread_reactions),'reactionThrough',coalesce((select max(seq) from unread_reactions),0)
 )
 );
end
$function$
;

CREATE OR REPLACE FUNCTION public.chat_stage_notice_rewrite(p_id uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if p_body is null or char_length(btrim(p_body)) not between 1 and 4000 then raise exception 'invalid_stage_notice'; end if;
 perform set_config('chat.stage_notice',p_id::text,true);
 update public.longboard_chat_messages set body=btrim(p_body),edited_at=now(),revision=revision+1
  where id=p_id and bot_slug='longboard' and deleted_at is null and body is distinct from btrim(p_body);
 perform set_config('chat.stage_notice','',true);
end $function$
;

drop table if exists public.chat_stage_broadcast_copies;
