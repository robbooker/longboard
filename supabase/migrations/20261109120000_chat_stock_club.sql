-- #386 Booker Stock Club: a read-only room that names the #1 stock of the day.
--
-- Room
--  * Room slug 'club' (room_state id 13). Read-only like Gainers: only the "Booker Stock Club" bot
--    (bot_slug 'club') posts, through post_chat_club_pick below; members read and react. No replies,
--    no edits, no mentions or push. Admins can still delete a post (change_chat_message's moderator
--    delete removes the row, which the guard allows).
--  * Access: an active 'club-room' entitlement (#384's member_account_has_entitlement), or the Gainers
--    rule, so every current Gainers member keeps it: any Longboard profile, a ShortScout monthly,
--    annual, lifetime or mastermind member, or an active 'gainers' entitlement. The app's rule is
--    clubRoomAccess in lib/chatAccess.ts.
--  * Stacked on #384 (20261109100000_members_stripe.sql), which must be applied first.
--    chat_account_has_room and chat_account_room_recipient_eligible are #384's definitions with
--    'club' added next to 'lb-review' and the club line; the four room-member functions are the
--    production definitions (identical on production and preview, read 2026-11-08; #384 doesn't
--    change them) with 'club' added. The rollback restores exactly those previous bodies.
--
-- The day's picks
--  * chat_club_days: one row per Eastern day: the morning-report candidates the last 15-minute run
--    saw (ranked, with their countries), and locked once an admin picks by hand (no more automatic
--    changes that day). The candidates also tell /api/chat/gainers/facts which tickers the lookup
--    program on Rob's computer should look up (country, cash, inst own) and borrow-check.
--  * chat_club_picks: every post: the day, ticker, auto or admin, and what the card shows (jsonb).
--  * post_chat_club_pick: the only way to post. Under a per-day lock it refuses an automatic post
--    when the day is locked or that stock was already posted today, so a rerun never posts twice.
--    An admin pick always posts and locks the day; the admin route unlocks it.
--  * RLS on, no policies, service role only. Read by /api/chat/club/* after a room access check.
--
-- Existing functions changed (exact previous bodies are in the rollback):
--   chat_account_has_room, chat_account_room_recipient_eligible, longboard_chat_room_member_count,
--   longboard_chat_room_member_names, longboard_chat_room_members, longboard_chat_room_members_ordered.
-- Existing constraints changed: six room_slug checks and longboard_chat_messages_actor_check.
-- Existing policy changed: "members read chat messages".
--
-- Apply after 20261109100000_members_stripe.sql (#384). Additive: the running app keeps working once this is applied. Apply it before the app that lists
-- the room ships (without it the cron answers 503 and the room's history is empty).
-- Rollback: supabase/rollbacks/20261109120000_chat_stock_club.down.sql

create table public.chat_club_days(
 day date primary key,
 candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(candidates)='array' and jsonb_array_length(candidates)<=50),
 candidates_at timestamptz,
 locked boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.chat_club_picks(
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null unique,
 day date not null,
 ticker text not null check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 source text not null check(source in ('auto','admin')),
 data jsonb not null check(jsonb_typeof(data)='object' and pg_column_size(data)<65536),
 created_at timestamptz not null default now()
);
create index chat_club_picks_day on public.chat_club_picks(day,created_at);
alter table public.chat_club_days enable row level security;
alter table public.chat_club_picks enable row level security;
revoke all on public.chat_club_days,public.chat_club_picks from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_club_days to service_role;
grant select,insert on public.chat_club_picks to service_role;

-- The room.
alter table public.chat_conversation_pins drop constraint chat_conversation_pins_room_slug_check;
alter table public.chat_conversation_pins add constraint chat_conversation_pins_room_slug_check CHECK (((room_slug IS NULL) OR (room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text]))));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text])));
alter table public.chat_login_requests drop constraint chat_login_requests_return_room_check;
alter table public.chat_login_requests add constraint chat_login_requests_return_room_check CHECK ((return_room = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text])));
alter table public.chat_room_notification_levels drop constraint chat_room_notification_levels_room_slug_check;
alter table public.chat_room_notification_levels add constraint chat_room_notification_levels_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'gainers'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text])));
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text])));
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check CHECK ((room_slug = ANY (ARRAY['main'::text, 'social'::text, 'shortscout'::text, 'lb-announcements'::text, 'ss-announcements'::text, 'gainers'::text, 'lb-recordings'::text, 'ss-recordings'::text, 'whats-new'::text, 'developers'::text, 'admins'::text, 'lb-review'::text, 'club'::text])));
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text))));

insert into public.longboard_chat_room_state(id,room_slug) values(13,'club');

alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins','lb-review','club')) or
 room_slug in ('social','gainers','whats-new','developers','lb-review','club') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));

-- Only the bot posts here, and only with its pick saved in the same transaction. No replies (also
-- not a forged cross-room reply), no edits.
create function public.enforce_chat_club_post() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.room_slug='club' then raise exception 'club_read_only'; end if;
 if new.room_slug='club' then
  if tg_op<>'INSERT' or new.member_id is not null or new.guest_id is not null or new.bot_slug is distinct from 'club'
   or new.author_label<>'Booker Stock Club' or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not exists(select 1 from public.chat_club_picks p where p.message_id=new.id)
  then raise exception 'club_read_only'; end if;
 end if;
 if new.reply_to_id is not null and exists(select 1 from public.longboard_chat_messages where id=new.reply_to_id and room_slug='club') then raise exception 'club_read_only'; end if;
 return new;
end $$;
revoke all on function public.enforce_chat_club_post() from public,anon,authenticated;
create trigger chat_club_post_guard before insert or update on public.longboard_chat_messages
 for each row execute function public.enforce_chat_club_post();

-- One post. 'auto' (the 15-minute run) posts only when the day isn't locked and that stock wasn't
-- posted yet today; 'admin' always posts and locks the day. Returns {posted, messageId | reason}.
create function public.post_chat_club_pick(p_day date,p_ticker text,p_source text,p_body text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid(); d public.chat_club_days;
begin
 if p_day is null or p_ticker is null or p_ticker !~ '^[A-Z][A-Z. ]{0,11}$' or p_source is null or p_source not in ('auto','admin')
  or p_body is null or char_length(btrim(p_body)) not between 1 and 2000 or p_data is null or jsonb_typeof(p_data)<>'object'
 then raise exception 'invalid_club_pick'; end if;
 insert into public.chat_club_days(day) values(p_day) on conflict(day) do nothing;
 select * into d from public.chat_club_days where day=p_day for update;
 if p_source='auto' then
  if d.locked then return jsonb_build_object('posted',false,'reason','locked'); end if;
  if exists(select 1 from public.chat_club_picks p where p.day=p_day and p.ticker=p_ticker) then
   return jsonb_build_object('posted',false,'reason','already_posted');
  end if;
 else
  update public.chat_club_days set locked=true,updated_at=now() where day=p_day;
 end if;
 insert into public.chat_club_picks(message_id,day,ticker,source,data) values(note_id,p_day,p_ticker,p_source,p_data);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'club','Booker Stock Club',btrim(p_body),'club');
 return jsonb_build_object('posted',true,'messageId',note_id);
end $$;
revoke all on function public.post_chat_club_pick(date,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.post_chat_club_pick(date,text,text,text,jsonb) to service_role;

-- #384's definition (20261109100000_members_stripe.sql) with 'club' added next to 'lb-review' and the
-- club-room entitlement line.

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
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','club') then exists(select 1 from public.profiles where id=p_account)
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

-- #384's definition (20261109100000_members_stripe.sql) with 'club' added next to 'lb-review' and the
-- club-room entitlement line.

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review','club') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
  -- #384: Booker Stock Club members.
  or (p_room='gainers' and public.member_account_has_entitlement(p_account,'gainers'))
  -- #386: Booker Stock Club room: the club-room entitlement, or the Gainers rule (also the 'gainers'
  -- entitlement), so every current Gainers member keeps it.
  or (p_room='club' and (public.member_account_has_entitlement(p_account,'club-room') or public.member_account_has_entitlement(p_account,'gainers')))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current definition (production and preview, read 2026-11-08) with 'club' added next to 'lb-review'.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Current definition (production and preview, read 2026-11-08) with 'club' added next to 'lb-review'.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_names(p_user_id uuid, p_room text, p_ids uuid[])
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') then raise exception 'invalid_room'; end if;
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

-- Current definition (production and preview, read 2026-11-08) with 'club' added next to 'lb-review'.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members(p_user_id uuid, p_room text, p_cursor uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text)
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') then raise exception 'invalid_room'; end if;
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

-- Current definition (production and preview, read 2026-11-08) with 'club' added next to 'lb-review'.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_members_ordered(p_user_id uuid, p_room text, p_query text DEFAULT ''::text, p_online_ids uuid[] DEFAULT '{}'::uuid[], p_after_rank integer DEFAULT NULL::integer, p_after_name text DEFAULT NULL::text, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, sort_rank integer, sort_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') then raise exception 'invalid_room'; end if;
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
