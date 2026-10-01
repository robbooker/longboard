-- In-app reaction events are separate from room mention rows and their push trigger.
create table public.chat_reaction_notifications (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity unique,
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 reactor_member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 room_message_id uuid references public.longboard_chat_messages(id) on delete cascade,
 dm_message_id uuid references public.longboard_chat_direct_messages(id) on delete cascade,
 emoji text not null check(emoji in ('like','heart','laugh','rob')),
 created_at timestamptz not null default clock_timestamp(), read_at timestamptz,
 check(num_nonnulls(room_message_id,dm_message_id)=1),
 unique(account_id,room_message_id,reactor_member_id,emoji),
 unique(account_id,dm_message_id,reactor_member_id,emoji)
);
create index chat_reaction_notifications_unread on public.chat_reaction_notifications(account_id,seq) where read_at is null;
create index chat_reaction_notifications_room on public.chat_reaction_notifications(room_message_id) where room_message_id is not null;
create index chat_reaction_notifications_dm on public.chat_reaction_notifications(dm_message_id) where dm_message_id is not null;
alter table public.chat_reaction_notifications enable row level security;
revoke all on public.chat_reaction_notifications from public,anon,authenticated;
grant all on public.chat_reaction_notifications to service_role;
grant usage,select on sequence public.chat_reaction_notifications_seq_seq to service_role;

create function public.record_chat_reaction_notification() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source jsonb; previous jsonb; room_message uuid; dm_message uuid; reactor uuid; reaction text;
 recipient uuid; recipient_member uuid; reactor_account uuid; target_room text;
begin
 source:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 room_message:=coalesce(source->>'room_message_id',source->>'message_id')::uuid;
 dm_message:=(source->>'dm_message_id')::uuid;
 reactor:=coalesce(source->>'member_id',source->>'guest_id')::uuid;
 reaction:=coalesce(source->>'emoji','like');
 if tg_op='DELETE' or not (source->>'active')::boolean then
  delete from public.chat_reaction_notifications where reactor_member_id=reactor and emoji=reaction
   and room_message_id is not distinct from room_message and dm_message_id is not distinct from dm_message;
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 -- Upsert retries never reset a read event. Only a false-to-true edge creates one.
 if tg_op='UPDATE' then
  previous:=to_jsonb(old);
  if (previous->>'active')::boolean then return new; end if;
 end if;
 select user_id into reactor_account from public.longboard_chat_members where id=reactor;
 if reactor_account is null then return new; end if;
 if room_message is not null then
  select member.user_id,m.member_id,m.room_slug into recipient,recipient_member,target_room
  from public.longboard_chat_messages m join public.longboard_chat_members member on member.id=m.member_id
  where m.id=room_message and m.deleted_at is null and not m.removed;
  if recipient is null or not public.chat_account_has_room(recipient,target_room) or not public.chat_account_has_room(reactor_account,target_room) then return new; end if;
 else
  select member.user_id,m.sender_id into recipient,recipient_member
  from public.longboard_chat_direct_messages m
  join public.longboard_chat_members member on member.id=m.sender_id
  join public.longboard_chat_conversations c on c.id=m.conversation_id
  where m.id=dm_message and m.deleted_at is null and c.status='accepted'
   and reactor in(c.requester_id,c.recipient_id) and m.sender_id in(c.requester_id,c.recipient_id);
  if recipient is null or not public.chat_account_has_room(recipient,'social') or not public.chat_account_has_room(reactor_account,'social') then return new; end if;
 end if;
 if reactor=recipient_member or exists(select 1 from public.longboard_chat_blocks b where
  (b.blocker_id=reactor and b.blocked_id=recipient_member) or (b.blocker_id=recipient_member and b.blocked_id=reactor)) then return new; end if;
 insert into public.chat_reaction_notifications(account_id,reactor_member_id,room_message_id,dm_message_id,emoji)
 values(recipient,reactor,room_message,dm_message,reaction) on conflict do nothing;
 return new;
end $$;
create trigger chat_like_notification after insert or update of active or delete on public.longboard_chat_reactions for each row execute function public.record_chat_reaction_notification();
create trigger chat_choice_notification after insert or update of active or delete on public.chat_message_reaction_choices for each row execute function public.record_chat_reaction_notification();
revoke all on function public.record_chat_reaction_notification() from public,anon,authenticated;
grant execute on function public.record_chat_reaction_notification() to service_role;

-- One shared, current authorization projection for listing and manual reads.
create function public.eligible_chat_reaction_notifications(p_actor uuid,p_rooms text[])
returns table(id uuid,seq bigint,kind text,room text,conversation_id uuid,message_id uuid,author text,emoji text,preview text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with me as (select id from public.longboard_chat_members where user_id=p_actor), eligible as (
  select n.id,n.seq,'room'::text kind,m.room_slug room,null::uuid conversation_id,m.id message_id,
   left(reactor.display_name,100) author,n.emoji,left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240) preview,n.created_at
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.id
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
  where n.account_id=p_actor and n.read_at is null and m.deleted_at is null and not m.removed
   and m.room_slug=any(p_rooms) and public.chat_account_has_room(p_actor,m.room_slug)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=reactor.id) or (b.blocker_id=reactor.id and b.blocked_id=me.id))
  union all
  select n.id,n.seq,'dm'::text,null::text,c.id,m.id,left(reactor.display_name,100),n.emoji,
   left(case when m.body='' and cardinality(m.attachment_ids)>0 then 'Shared an attachment' else m.body end,240),n.created_at
  from public.chat_reaction_notifications n join me on true
  join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.id
  join public.longboard_chat_conversations c on c.id=m.conversation_id and me.id in(c.requester_id,c.recipient_id)
  join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
  where n.account_id=p_actor and n.read_at is null and m.deleted_at is null and c.status='accepted'
   and public.chat_account_has_room(p_actor,'social')
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=reactor.id) or (b.blocker_id=reactor.id and b.blocked_id=me.id))
 ) select * from eligible;
$$;
revoke all on function public.eligible_chat_reaction_notifications(uuid,text[]) from public,anon,authenticated;
grant execute on function public.eligible_chat_reaction_notifications(uuid,text[]) to service_role;

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
  select c.*,me.id as my_id,left(other.display_name,100) as other_name,
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
 ), reactions as (select * from public.eligible_chat_reaction_notifications(actor,rooms))
 select jsonb_build_object(
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,240),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,96),'threadRootId',thread_root_id) item from mentions order by seq desc limit 50) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from mentions),'mentionThrough',coalesce((select max(seq) from mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from mentions group by room_slug) cursors),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending','messageId',message_id,'preview',preview,'createdAt',latest_at) item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'dmCount',coalesce((select sum(unread) from dms),0),'dmThrough',coalesce((select max(through_seq) from dms),0),
  'reactions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_strip_nulls(jsonb_build_object('id',id,'seq',seq,'kind',kind,'room',room,'conversationId',conversation_id,'messageId',message_id,'author',author,'emoji',emoji,'preview',preview,'createdAt',created_at)) item from reactions order by seq desc limit 50) listed),'[]'::jsonb),
  'reactionCount',(select count(*) from reactions),'reactionThrough',coalesce((select max(seq) from reactions),0)
 );
$$;

-- Optional new cursors do not change the existing read_chat_activity signature.
create function public.read_chat_activity_notifications(actor uuid,rooms text[],mention_through bigint default 0,mention_id uuid default null,dm_through bigint default 0,dm_conversation uuid default null,reaction_through bigint default 0,reaction_id uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if reaction_through<0 or reaction_through is null then raise exception 'invalid_cursor'; end if;
 perform public.read_chat_activity(actor,rooms,mention_through,mention_id,dm_through,dm_conversation);
 update public.chat_reaction_notifications n set read_at=clock_timestamp()
 from public.eligible_chat_reaction_notifications(actor,rooms) eligible
 where n.id=eligible.id and n.seq<=reaction_through and (reaction_id is null or n.id=reaction_id);
end $$;
revoke all on function public.read_chat_activity_notifications(uuid,text[],bigint,uuid,bigint,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.read_chat_activity_notifications(uuid,text[],bigint,uuid,bigint,uuid,bigint,uuid) to service_role;
