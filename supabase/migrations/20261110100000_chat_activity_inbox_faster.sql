-- HEALTH-2026-11-09-1 (ticket #391): a cheaper bell (chat_activity_inbox), same results.
--
-- chat_activity_inbox runs on every bell and unread poll (every 30 s per open tab, every 10 s when
-- offline): 745,264 calls in the week to November 9, 16.0 ms mean, 31.4% of all database time.
-- There is no missing index and no table scan: every read is by key. The time is spread over many
-- small reads, so this removes the ones that are repeated or not needed:
--
--  * Room access: the bell checked each requested room with its own chat_account_has_room call,
--    and each call read the same bot list, admin flag and profile again (and, for a ShortScout
--    member without a Longboard profile, the whole ShortScout identity again). That was about a
--    fifth of the bell. chat_account_rooms(account, rooms) gives the same answer for a whole list
--    with each of those read at most once, and only when a room needs it. The Social check for DMs
--    is part of the same call.
--  * Unread mentions: the count read every unread mention with its author and message text, only
--    to count them. It now reads only the room and number, in one pass for all four totals.
--  * Blocks: the checks on reply-to messages skip their read when nobody is blocked either way.
--  * Unread reactions: the count no longer reads the reactor's member row (see the note there).
--
-- What is the same: the signature, the security (not SECURITY DEFINER, empty search_path), the
-- order and size of every list, every count and cursor, the room levels, the blocks rules and the
-- pinned-DM rule. The newest 50 still walk newest first and stop at 50, as in
-- 20261102120000_chat_activity_inbox_stop_early.sql.
--
-- chat_account_rooms repeats chat_account_has_room's rule (20261109120000_chat_stock_club.sql).
-- Any change to that rule must change both (the comment on chat_account_has_room says so);
-- scripts/sql/chat-account-rooms-compare.sql checks they agree for every account and room.
--
-- No table change and no index, so no extra write cost. CREATE OR REPLACE takes only a brief
-- catalog lock, so it is safe at any time and inside a transaction. Nothing in the app changes.
-- Rollback: supabase/rollbacks/20261110100000_chat_activity_inbox_faster.down.sql

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
  when u.room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','club','admins') or u.room is null then false
  -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
  when u.room='admins' then not exists(select 1 from bot) and (select yes from admin)
  -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
  when exists(select 1 from bot) then exists(select 1 from bot where u.room=any(bot.allowed_rooms))
  when (select yes from admin) then true
  when u.room in ('main','lb-announcements','lb-recordings') then (select yes from cohort)
  when u.room in ('social','gainers','whats-new','developers','lb-review','club') then (select yes from profile)
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

REVOKE ALL ON FUNCTION public.chat_account_rooms(uuid, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_account_rooms(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.chat_account_has_room(uuid, text) IS
 'The chat room access rule. chat_account_rooms (20261110100000_chat_activity_inbox_faster.sql) repeats it for a list of rooms: change both together; scripts/sql/chat-account-rooms-compare.sql checks they agree.';

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
