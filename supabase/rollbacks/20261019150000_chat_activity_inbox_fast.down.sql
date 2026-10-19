-- Rollback for 20261019150000_chat_activity_inbox_fast.sql. Safe at any time: puts back the
-- LANGUAGE sql definitions exactly as they were on prod before (same signatures and results;
-- only slower). chat_activity_inbox goes back to the 20261015180000_chat_room_notification_levels
-- version; the three ShortScout helpers to the 20261001190002_chat_shortscout_authorization version.
-- CREATE OR REPLACE resets the SET plan_cache_mode clause, so nothing else needs undoing.

CREATE OR REPLACE FUNCTION public.chat_shortscout_binding(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
 ) i order by bridged limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.chat_shortscout_authorized_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',a.membership_level,'authorized_until',a.valid_until)
 from binding join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where a.decision='allow' and a.valid_until>now();
$function$;

CREATE OR REPLACE FUNCTION public.chat_shortscout_identity(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(public.chat_shortscout_authorized_identity(p_account),(
  select b||jsonb_build_object('membership_level',case when b->>'membership_level'='mastermind' then l.membership_level else b->>'membership_level' end)
  from (select public.chat_shortscout_binding(p_account) b) binding
  join public.chat_shortscout_legacy_access l on l.subject=(b->>'subject')::uuid
  cross join public.chat_shortscout_rollout rollout
  where now()<rollout.legacy_until and now()<l.expires_at
   and b->>'membership_level' in ('monthly','annual','lifetime','mastermind')
   and not exists(select 1 from public.chat_shortscout_authorization a where a.subject=l.subject)
 ));
$function$;

CREATE OR REPLACE FUNCTION public.chat_activity_inbox(actor uuid, rooms text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with access as materialized (select coalesce(array(select r from unnest(rooms) r where public.chat_account_has_room(actor,r)),'{}'::text[]) allowed_rooms),
 me as (select id from public.longboard_chat_members where user_id=actor),
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
   and not exists(select 1 from public.longboard_chat_blocks b join me on true where
    (b.blocker_id=me.id and b.blocked_id in(m.member_id,parent.member_id)) or (b.blocked_id=me.id and b.blocker_id in(m.member_id,parent.member_id)))
 ), unread_mentions as (select * from mentions where read_at is null), conversations as (
  select c.*,me.id as my_id,left(other.display_name,100) as other_name,other.user_id as other_account,
   case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end as read_seq
  from me join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
  join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
  where c.status<>'declined' and public.chat_account_has_room(actor,'social')
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id))
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
 ), pinned_dms as (
  -- Same actor, participant, accepted-state, blocks and recipient policy as chat_pins.
  -- Join before the preview limit; zero is explicit, never inferred from a missing preview.
  select c.id,coalesce(d.unread,0) unread
  from public.chat_conversation_pins p join conversations c on c.id=p.conversation_id
  left join dm_counts d on d.id=c.id
  where p.account_id=actor and c.status='accepted'
   and public.chat_account_room_recipient_eligible(c.other_account,'social')
  order by p.id limit 50
 ), reactions as (
 (
  select n.id,n.seq,'room'::text kind,m.room_slug room,null::uuid conversation_id,m.id message_id,
   left(reactor.display_name,100) author,n.emoji,left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240) preview,n.created_at,n.read_at is not null as read
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
  where n.account_id=actor and n.room_message_id is not null and m.deleted_at is null and not m.removed
   and m.room_slug=any(rooms) and m.room_slug=any((select allowed_rooms from access)::text[])
   and m.room_slug<>all((select quiet_reactions from levels)::text[])
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=reactor.id) or (b.blocker_id=reactor.id and b.blocked_id=me.id))

  order by n.seq desc limit 50
 ) union all (
  select n.id,n.seq,'dm'::text,null::text,c.id,m.id,left(reactor.display_name,100),n.emoji,
   left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240),n.created_at,n.read_at is not null
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
  join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
  where n.account_id=actor and n.dm_message_id is not null and m.deleted_at is null and c.status='accepted'
   and public.chat_account_has_room(actor,'social')
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=reactor.id) or (b.blocker_id=reactor.id and b.blocked_id=me.id))
  order by n.seq desc limit 50
 )
 ),
 unread_reactions as (select * from public.eligible_chat_reaction_notifications(actor,array(select r from unnest(rooms) r where r<>all((select quiet_reactions from levels)::text[]))))
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
 );
$function$;
