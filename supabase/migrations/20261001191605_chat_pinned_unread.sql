-- Add complete counts for at most 50 authorized pinned DMs to the existing activity read.
-- No read markers, write behavior, notification counts or preview limits change.
create or replace function public.chat_activity_inbox(actor uuid, rooms text[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 with me as (select id from public.longboard_chat_members where user_id=actor),
 mentions as (
  select n.*,left(m.author_label,100) author_label,m.body,
   case when parent.deleted_at is null then parent.body else null end parent_body
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
  where n.account_id=actor and n.room_slug=any(rooms) and n.read_at is null and m.deleted_at is null and not m.removed
   and public.chat_account_has_room(actor,n.room_slug)
   and not exists(select 1 from public.longboard_chat_blocks b join me on true where
    (b.blocker_id=me.id and b.blocked_id in(m.member_id,parent.member_id)) or (b.blocked_id=me.id and b.blocker_id in(m.member_id,parent.member_id)))
 ), conversations as (
  select c.*,me.id as my_id,left(other.display_name,100) as other_name,other.user_id as other_account,
   case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end as read_seq
  from me join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
  join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
  where c.status<>'declined' and public.chat_account_has_room(actor,'social')
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id))
 ), incoming as (
  select c.id,c.other_name,c.status,d.seq,d.created_at
  from conversations c join public.longboard_chat_direct_messages d on d.conversation_id=c.id
  where d.sender_id<>c.my_id and d.seq>c.read_seq and d.deleted_at is null
 ), dm_counts as (
  select i.id,i.other_name,i.status,count(*) unread,max(i.seq) through_seq,max(i.created_at) latest_at
  from incoming i group by i.id,i.other_name,i.status
 ), dms as (
  select c.*,d.id message_id,left(case when d.body='' and cardinality(d.attachment_ids)>0 then 'Shared an attachment' else d.body end,240) preview
  from dm_counts c join public.longboard_chat_direct_messages d on d.conversation_id=c.id and d.seq=c.through_seq
 ), pinned_dms as (
  -- Same actor, participant, accepted-state, blocks and recipient policy as chat_pins.
  -- Join before the preview limit; zero is explicit, never inferred from a missing preview.
  select c.id,coalesce(d.unread,0) unread
  from public.chat_conversation_pins p join conversations c on c.id=p.conversation_id
  left join dm_counts d on d.id=c.id
  where p.account_id=actor and c.status='accepted'
   and public.chat_account_room_recipient_eligible(c.other_account,'social')
  order by p.id limit 50
 ), reactions as (select * from public.eligible_chat_reaction_notifications(actor,rooms))
 select jsonb_build_object(
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,240),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,96),'threadRootId',thread_root_id) item from mentions order by seq desc limit 50) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from mentions),'mentionThrough',coalesce((select max(seq) from mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from mentions group by room_slug) cursors),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending','messageId',message_id,'preview',preview,'createdAt',latest_at) item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'pinnedDmUnread',coalesce((select jsonb_object_agg(id,unread) from pinned_dms),'{}'::jsonb),
  'dmCount',coalesce((select sum(unread) from dms),0),'dmThrough',coalesce((select max(through_seq) from dms),0),
  'reactions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_strip_nulls(jsonb_build_object('id',id,'seq',seq,'kind',kind,'room',room,'conversationId',conversation_id,'messageId',message_id,'author',author,'emoji',emoji,'preview',preview,'createdAt',created_at)) item from reactions order by seq desc limit 50) listed),'[]'::jsonb),
  'reactionCount',(select count(*) from reactions),'reactionThrough',coalesce((select max(seq) from reactions),0)
 );
$$;
