-- Rollback for 20261015180000_chat_room_notification_levels.sql: the production definitions
-- captured on 2026-10-15 before that migration, then the table. Safe at any time: the app hides
-- the room notification setting when the bell has no roomLevels, and treats every room as "all".
-- Deletes everyone's saved room levels.
begin;
CREATE OR REPLACE FUNCTION public.chat_activity_inbox(actor uuid, rooms text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with access as materialized (select coalesce(array(select r from unnest(rooms) r where public.chat_account_has_room(actor,r)),'{}'::text[]) allowed_rooms),
 me as (select id from public.longboard_chat_members where user_id=actor),
 mentions as not materialized (
  select n.*,left(coalesce(sender.display_name,m.author_label),100) author_label,m.body,
   case when parent.deleted_at is null then parent.body else null end parent_body
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  left join public.longboard_chat_members sender on sender.id=m.member_id and m.bot_slug is null
  left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
  where n.account_id=actor and n.room_slug=any(rooms) and m.deleted_at is null and not m.removed
   and n.room_slug=any((select allowed_rooms from access)::text[])
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
 unread_reactions as (select * from public.eligible_chat_reaction_notifications(actor,rooms))
 select jsonb_build_object(
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

CREATE OR REPLACE FUNCTION public.queue_chat_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  if new.room_slug not in ('main','social','shortscout') then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $function$;

CREATE OR REPLACE FUNCTION public.chat_push_target(kind text, source uuid, actor uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when kind='dm' then (
  select '/chat?dm='||c.id from public.longboard_chat_direct_messages d
  join public.longboard_chat_conversations c on c.id=d.conversation_id
  join public.longboard_chat_members me on me.user_id=actor and me.id in(c.requester_id,c.recipient_id)
  where d.id=source and d.deleted_at is null and c.status='accepted' and d.sender_id<>me.id
  and public.chat_account_room_recipient_eligible(actor,'social')
  and exists(select 1 from public.longboard_chat_members sender where sender.id=d.sender_id and public.chat_account_room_recipient_eligible(sender.user_id,'social'))
  and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=d.sender_id) or (b.blocked_id=me.id and b.blocker_id=d.sender_id))
 ) else (
  select '/chat?room='||n.room_slug||'&thread='||coalesce(n.thread_root_id,m.reply_to_id,m.id)
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  join public.longboard_chat_members me on me.user_id=actor
  left join public.longboard_chat_messages root on root.id=n.thread_root_id
  left join public.chat_activity_preferences p on p.account_id=actor
  where n.id=source and n.account_id=actor and n.read_at is null and m.member_id is distinct from me.id
  and public.chat_account_room_recipient_eligible(actor,n.room_slug) and (n.category<>'reply' or coalesce(p.replies,true))
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id in(m.member_id,root.member_id)) or (b.blocked_id=me.id and b.blocker_id in(m.member_id,root.member_id)))
 ) end;
$function$;

drop table public.chat_room_notification_levels;
commit;
