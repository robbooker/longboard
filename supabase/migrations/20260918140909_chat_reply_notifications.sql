-- Reuse the durable room-alert inbox and its account/message uniqueness.
create table public.chat_activity_preferences (
 account_id uuid primary key references public.chat_accounts(id) on delete cascade,
 replies boolean not null default true
);
alter table public.chat_activity_preferences enable row level security;
revoke all on public.chat_activity_preferences from public,anon,authenticated;
grant all on public.chat_activity_preferences to service_role;
alter table public.chat_room_mentions add column category text not null default 'mention' check(category in ('mention','reply')),
 add column thread_root_id uuid references public.longboard_chat_messages(id) on delete cascade;

create function public.record_chat_room_replies() returns trigger
language plpgsql security invoker set search_path='' as $$
declare root_id uuid; root_member uuid;
begin
 if new.reply_to_id is null then return new; end if;
 -- Follow parents within the same room, tolerating malformed cycles defensively.
 with recursive ancestors as (
  select m.id,m.reply_to_id,m.member_id,array[m.id] visited from public.longboard_chat_messages m where m.id=new.reply_to_id and m.room_slug=new.room_slug
  union all
  select m.id,m.reply_to_id,m.member_id,a.visited||m.id from ancestors a join public.longboard_chat_messages m on m.id=a.reply_to_id and m.room_slug=new.room_slug where not m.id=any(a.visited)
 ) select id,member_id into root_id,root_member from ancestors where reply_to_id is null;
 if root_id is null then return new; end if;
 with recursive thread as (
  select m.id,m.member_id,array[m.id] visited from public.longboard_chat_messages m where m.id=root_id
  union all
  select m.id,m.member_id,t.visited||m.id from thread t join public.longboard_chat_messages m on m.reply_to_id=t.id and m.room_slug=new.room_slug where m.id<>new.id and not m.id=any(t.visited)
 )
 insert into public.chat_room_mentions(account_id,message_id,room_slug,category,thread_root_id)
 select distinct member.user_id,new.id,new.room_slug,'reply',root_id
 from thread t join public.longboard_chat_members member on member.id=t.member_id
 left join public.chat_activity_preferences p on p.account_id=member.user_id
 where member.id is distinct from new.member_id and coalesce(p.replies,true)
 and public.chat_account_has_room(member.user_id,new.room_slug)
 and not exists(select 1 from public.longboard_chat_blocks b where
  (b.blocker_id=member.id and b.blocked_id in (new.member_id,root_member)) or
  (b.blocked_id=member.id and b.blocker_id in (new.member_id,root_member)))
 on conflict(account_id,message_id) do update set category='reply',thread_root_id=excluded.thread_root_id;
 return new;
end $$;
revoke all on function public.record_chat_room_replies() from public,anon,authenticated;
grant execute on function public.record_chat_room_replies() to service_role;
create trigger chat_room_reply_events after insert on public.longboard_chat_messages for each row execute function public.record_chat_room_replies();

-- Editing a reply must not erase its independently generated reply alert.
create or replace function public.record_chat_room_mentions() returns trigger
language plpgsql security invoker set search_path=public as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; person record; recipients uuid[]:='{}'; recipient uuid;
begin
 if new.room_slug in ('lb-announcements','ss-announcements') then return new; end if;
 if new.member_id is not null then
  loop
   relative_pos:=strpos(substr(new.body,scan_from),'@');exit when relative_pos=0;
   at_pos:=scan_from+relative_pos-1;scan_from:=at_pos+1;
   if at_pos>1 and substr(new.body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
   select m.id,m.user_id into person from longboard_chat_members m
   where lower(substr(new.body,at_pos+1,length(m.display_name)))=lower(m.display_name)
   and substr(new.body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   order by length(m.display_name) desc,m.id limit 1;
   if person.id is not null and person.id<>new.member_id and public.chat_account_has_room(person.user_id,new.room_slug) and not exists(select 1 from longboard_chat_blocks b where (b.blocker_id=person.id and b.blocked_id=new.member_id) or (b.blocked_id=person.id and b.blocker_id=new.member_id)) then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and category='mention' and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $$;


create or replace function public.chat_activity_inbox(actor uuid, rooms text[]) returns jsonb
language sql stable security invoker set search_path=public as $$
 with me as (select id from longboard_chat_members where user_id=actor),
 mentions as (select n.*,m.author_label,m.body,parent.body as parent_body from chat_room_mentions n join longboard_chat_messages m on m.id=n.message_id left join longboard_chat_messages parent on parent.id=n.thread_root_id where n.account_id=actor and n.room_slug=any(rooms) and n.read_at is null and (n.category<>'reply' or (public.chat_account_has_room(actor,n.room_slug) and not exists(select 1 from longboard_chat_blocks b join longboard_chat_members recipient on recipient.user_id=actor where (b.blocker_id=recipient.id and b.blocked_id in (m.member_id,parent.member_id)) or (b.blocked_id=recipient.id and b.blocker_id in (m.member_id,parent.member_id)))))),
 conversations as (
  select c.*,me.id as my_id,other.display_name as other_name,
   case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end as read_seq
  from me join longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
  join longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
  where c.status<>'declined' and not exists(select 1 from longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id))
 ), dms as (
  select c.id,c.other_name,c.status,count(*) as unread,max(d.seq) as through_seq,max(d.created_at) as latest_at
  from conversations c join longboard_chat_direct_messages d on d.conversation_id=c.id and d.sender_id<>c.my_id and d.seq>c.read_seq
  group by c.id,c.other_name,c.status
 )
 select jsonb_build_object(
  'replyNotifications',coalesce((select replies from chat_activity_preferences where account_id=actor),true),
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,180),'createdAt',created_at,'category',category,'parentPreview',left(parent_body,180),'threadRootId',thread_root_id) item from mentions order by seq desc limit 50) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from mentions),
  'mentionThrough',coalesce((select max(seq) from mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from mentions group by room_slug) cursors),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending') item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'dmCount',coalesce((select sum(unread) from dms),0),
  'dmThrough',coalesce((select max(through_seq) from dms),0)
 );
$$;

-- The room feed does not render thread replies: only explicit alert/all-read
-- actions acknowledge those. Older clients keep their existing RPC signature.
create function public.read_visible_chat_room_alerts(actor uuid, room text, through_seq bigint) returns void
language sql security invoker set search_path='' as $$
 update public.chat_room_mentions set read_at=now() where account_id=actor and room_slug=room
 and category<>'reply' and read_at is null and seq<=through_seq;
$$;
revoke all on function public.read_visible_chat_room_alerts(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.read_visible_chat_room_alerts(uuid,text,bigint) to service_role;
