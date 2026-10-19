-- HEALTH-2026-10-19-3: the bell's chat_activity_inbox took 33.8% of database time (mean 46 ms over
-- 31,609 calls; other chat reads 1-4 ms). Nothing was missing an index: every table it reads is
-- under 3 MB and each row is found by key. The time went to work repeated on every call:
--  * planning: a LANGUAGE sql function is planned again on every call. The inbox is one large
--    query (about 11 ms to plan), and the ShortScout identity helpers it reaches through
--    chat_account_has_room are re-planned on every call too (about 3 ms per ShortScout room).
--  * room checks done three times: once for the rooms, again inside
--    eligible_chat_reaction_notifications for the unread reaction count, and once more for social
--    in each of three places (conversations, DM reactions, the helper's DM reactions).
--  * the pinned-DM recipient check ran for every conversation before the pin join.
--  * one blocks probe per listed mention, reaction and conversation.
--
-- Same signatures, same results, row for row (checked on prod against the live function for every
-- chat account with several room lists). What changes:
--  * chat_activity_inbox: plpgsql, so the plan is cached per connection (generic plan, no per-call
--    planning). Rooms are checked once; social reuses that check when it is in rooms. Blocks read
--    once into an array. Pins joined before the recipient check. Reactions read once: the newest
--    50 and the unread count/cursor come from the same rows (seq is unique and each notification
--    is either a room or a DM row, so the newest 50 are the same rows as before).
--  * chat_shortscout_binding, chat_shortscout_authorized_identity, chat_shortscout_identity:
--    the same SELECT, now in plpgsql so their plans are cached too. They feed every room check
--    (chat_account_has_room) and the renewal path, so those get cheaper as well.
-- Measured on prod (EXPLAIN ANALYZE, warm connection): inbox body 30-55 ms before, 8-9 ms after
-- for a busy admin; ShortScout members also save about 2-3 ms per ShortScout room check.
--
-- No table change, no index, no lock beyond the brief catalog update of CREATE OR REPLACE.
-- Safe at any time; nothing in the app changes.
-- Rollback: supabase/rollbacks/20261019150000_chat_activity_inbox_fast.down.sql

-- Same query as before (20261001190002_chat_shortscout_authorization.sql), plan now cached.
CREATE OR REPLACE FUNCTION public.chat_shortscout_binding(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
select to_jsonb(i) from (
  select p.subject,p.membership_level,p.verified_at,p.account_id source_account_id,false bridged,
    p.account_id::text binding_version
  from public.chat_provider_identities p where p.account_id=p_account and p.provider='shortscout'
  union all
  select p.subject,p.membership_level,p.verified_at,p.account_id,true,
    p.account_id::text||':'||l.updated_at::text
  from public.chat_shortscout_membership_links l
  join public.chat_provider_identities p on (p.provider,p.subject,p.account_id)=(l.provider,l.subject,l.source_account_id)
  join public.chat_accounts a on a.id=l.lb_account_id
  join public.chat_accounts source on source.id=l.source_account_id
  join public.profiles profile on profile.id=a.longboard_user_id
  where l.lb_account_id=p_account and l.revoked_at is null and source.longboard_user_id is null and a.id=a.longboard_user_id
   and not exists(select 1 from public.chat_provider_identities direct where direct.account_id=p_account and direct.provider='shortscout')
 ) i order by bridged limit 1
 );
end
$function$;

-- Same query as before, plan now cached.
CREATE OR REPLACE FUNCTION public.chat_shortscout_authorized_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',a.membership_level,'authorized_until',a.valid_until)
 from binding join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where a.decision='allow' and a.valid_until>now()
 );
end
$function$;

-- Same expression as before, plan now cached.
CREATE OR REPLACE FUNCTION public.chat_shortscout_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
select coalesce(public.chat_shortscout_authorized_identity(p_account),(
  select b||jsonb_build_object('membership_level',case when b->>'membership_level'='mastermind' then l.membership_level else b->>'membership_level' end)
  from (select public.chat_shortscout_binding(p_account) b) binding
  join public.chat_shortscout_legacy_access l on l.subject=(b->>'subject')::uuid
  cross join public.chat_shortscout_rollout rollout
  where now()<rollout.legacy_until and now()<l.expires_at
   and b->>'membership_level' in ('monthly','annual','lifetime','mastermind')
   and not exists(select 1 from public.chat_shortscout_authorization a where a.subject=l.subject)
 ))
 );
end
$function$;

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
 ), unread_mentions as (select * from mentions where read_at is null), conversations as (
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
 ), all_reactions as materialized (
  -- Every reaction the bell may show (read or not). The list takes the newest 50 and the unread
  -- count reads the same rows: one pass instead of a second eligible_chat_reaction_notifications
  -- call that re-checked every room's access. seq is unique, so the newest 50 are the same rows.
  select n.id,n.seq,'room'::text kind,m.room_slug room,null::uuid conversation_id,m.id message_id,
   left(reactor.display_name,100) author,n.emoji,left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240) preview,n.created_at,n.read_at is not null as read
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
  where n.account_id=actor and n.room_message_id is not null and m.deleted_at is null and not m.removed
   and m.room_slug=any(rooms) and m.room_slug=any((select allowed_rooms from access)::text[])
   and m.room_slug<>all((select quiet_reactions from levels)::text[])
   and reactor.id<>all((select ids from blocked)::uuid[])
  union all
  select n.id,n.seq,'dm'::text,null::text,c.id,m.id,left(reactor.display_name,100),n.emoji,
   left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240),n.created_at,n.read_at is not null
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
  join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
  where n.account_id=actor and n.dm_message_id is not null and m.deleted_at is null and c.status='accepted'
   and (select social_ok from access)
   and reactor.id<>all((select ids from blocked)::uuid[])
 ),
 reactions as (select * from all_reactions order by seq desc limit 50),
 unread_reactions as (select * from all_reactions where not read)
 select jsonb_build_object(
  'roomLevels',(select room_levels from levels),
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,240),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,96),'threadRootId',thread_root_id,'read',read_at is not null) item from mentions order by seq desc limit 50) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from unread_mentions),'mentionThrough',coalesce((select max(seq) from unread_mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from unread_mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from unread_mentions group by room_slug) cursors),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending','messageId',message_id,'preview',preview,'createdAt',latest_at) item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'pinnedDmUnread',coalesce((select jsonb_object_agg(id,unread) from pinned_dms),'{}'::jsonb),
  'dmCount',coalesce((select sum(unread) from dm_counts),0),'dmThrough',coalesce((select max(through_seq) from dm_counts),0),
  'reactions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_strip_nulls(jsonb_build_object('id',id,'seq',seq,'kind',kind,'room',room,'conversationId',conversation_id,'messageId',message_id,'author',author,'emoji',emoji,'preview',preview,'createdAt',created_at,'read',read)) item from reactions order by seq desc limit 50) listed),'[]'::jsonb),
  'reactionCount',(select count(*) from unread_reactions),'reactionThrough',coalesce((select max(seq) from unread_reactions),0)
 )
 );
end
$function$;
