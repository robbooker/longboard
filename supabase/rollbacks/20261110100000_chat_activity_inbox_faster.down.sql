-- Rollback for 20261110100000_chat_activity_inbox_faster.sql. Safe at any time: puts back
-- chat_activity_inbox exactly as 20261102120000_chat_activity_inbox_stop_early.sql defined it (same
-- signature and results, only slower), then removes chat_account_rooms, which nothing else uses,
-- and the comment on chat_account_has_room.

CREATE OR REPLACE FUNCTION public.chat_activity_inbox(actor uuid, rooms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
 with allowed as materialized (select coalesce(array(select r from unnest(rooms) r where public.chat_account_has_room(actor,r)),'{}'::text[]) allowed_rooms),
 access as materialized (
  -- One room check per room, reused below: DMs need social access whether or not social is in
  -- rooms, so its own check runs only when social was not asked for.
  select allowed_rooms,
   case when 'social'=any(rooms) then 'social'=any(allowed_rooms) else public.chat_account_has_room(actor,'social') end social_ok
  from allowed
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
 mentions as not materialized (
  select n.*,left(coalesce(sender.display_name,m.author_label),100) author_label,m.body,
   case when parent.deleted_at is null then parent.body else null end parent_body
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  left join public.longboard_chat_members sender on sender.id=m.member_id and m.bot_slug is null
  left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
  where n.account_id=actor and n.room_slug=any(rooms) and m.deleted_at is null and not m.removed
   and n.room_slug=any((select allowed_rooms from access)::text[])
   and n.room_slug<>all((select quiet_mentions from levels)::text[])
   and not coalesce(m.member_id=any((select ids from blocked)::uuid[]),false)
   and not coalesce(parent.member_id=any((select ids from blocked)::uuid[]),false)
 ), unread_mentions as (select * from mentions where read_at is null),
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
 unread_reactions as materialized (
  select n.seq
  from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.read_at is null and x.room_message_id is not null offset 0) n join me on true
  join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
  where m.deleted_at is null and not m.removed
   and m.room_slug=any(rooms) and m.room_slug=any((select allowed_rooms from access)::text[])
   and m.room_slug<>all((select quiet_reactions from levels)::text[])
   and reactor.id<>all((select ids from blocked)::uuid[])
  union all
  select n.seq
  from (select x.* from public.chat_reaction_notifications x where x.account_id=actor and x.read_at is null and x.dm_message_id is not null offset 0) n join me on true
  join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
  join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
  where m.deleted_at is null and c.status='accepted'
   and (select social_ok from access)
   and reactor.id<>all((select ids from blocked)::uuid[])
 )
 select jsonb_build_object(
  'roomLevels',(select room_levels from levels),
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,240),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,96),'threadRootId',thread_root_id,'read',read_at is not null) item from listed_mentions) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from unread_mentions),'mentionThrough',coalesce((select max(seq) from unread_mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from unread_mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from unread_mentions group by room_slug) cursors),
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

DROP FUNCTION IF EXISTS public.chat_account_rooms(uuid, text[]);
COMMENT ON FUNCTION public.chat_account_has_room(uuid, text) IS NULL;
