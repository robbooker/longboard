create table public.chat_room_mentions (
 id uuid primary key default gen_random_uuid(), seq bigint generated always as identity unique,
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 message_id uuid not null references public.longboard_chat_messages(id) on delete cascade,
 room_slug text not null check(room_slug in ('main','social','shortscout')),
 created_at timestamptz not null default now(), read_at timestamptz,
 unique(account_id,message_id)
);
create index chat_room_mentions_unread on public.chat_room_mentions(account_id,room_slug,seq) where read_at is null;
alter table public.chat_room_mentions enable row level security;
revoke all on public.chat_room_mentions from public,anon,authenticated;
grant all on public.chat_room_mentions to service_role;
grant usage,select on sequence public.chat_room_mentions_seq_seq to service_role;

-- Literal, case-insensitive names; choose the longest valid name at each @.
create function public.record_chat_room_mentions() returns trigger
language plpgsql security invoker set search_path=public as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; person record; recipients uuid[]:='{}'; recipient uuid;
begin
 if new.member_id is not null then
  loop
   relative_pos:=strpos(substr(new.body,scan_from),'@');exit when relative_pos=0;
   at_pos:=scan_from+relative_pos-1;scan_from:=at_pos+1;
   if at_pos>1 and substr(new.body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
   select m.id,m.user_id into person from longboard_chat_members m
   where lower(substr(new.body,at_pos+1,length(m.display_name)))=lower(m.display_name)
   and substr(new.body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   order by length(m.display_name) desc,m.id limit 1;
   if person.id is not null and person.id<>new.member_id then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $$;
create trigger chat_room_mention_events after insert or update of body on public.longboard_chat_messages for each row execute function public.record_chat_room_mentions();

create function public.chat_activity_inbox(actor uuid, rooms text[]) returns jsonb
language sql stable security invoker set search_path=public as $$
 with me as (select id from longboard_chat_members where user_id=actor),
 mentions as (select n.*,m.author_label,m.body from chat_room_mentions n join longboard_chat_messages m on m.id=n.message_id where n.account_id=actor and n.room_slug=any(rooms) and n.read_at is null),
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
  'mentions',coalesce((select jsonb_agg(item order by seq desc) from (select seq,jsonb_build_object('id',id,'seq',seq,'messageId',message_id,'room',room_slug,'author',author_label,'preview',left(body,180),'createdAt',created_at) item from mentions order by seq desc limit 50) listed),'[]'::jsonb),
  'mentionCount',(select count(*) from mentions),
  'mentionThrough',coalesce((select max(seq) from mentions),0),
  'roomCounts',(select coalesce(jsonb_object_agg(room,total),'{}'::jsonb) from (select room_slug room,count(*) total from mentions group by room_slug) counts),
  'roomThrough',(select coalesce(jsonb_object_agg(room,latest),'{}'::jsonb) from (select room_slug room,max(seq) latest from mentions group by room_slug) cursors),
  'dms',coalesce((select jsonb_agg(item order by latest_at desc) from (select latest_at,jsonb_build_object('id',id,'name',other_name,'unread',unread,'throughSeq',through_seq,'pending',status='pending') item from dms order by latest_at desc limit 100) listed),'[]'::jsonb),
  'dmCount',coalesce((select sum(unread) from dms),0),
  'dmThrough',coalesce((select max(through_seq) from dms),0)
 );
$$;

-- Cutoffs come from the displayed snapshot; arrivals after it remain unread.
create function public.read_chat_activity(actor uuid, rooms text[], mention_through bigint default 0, mention_id uuid default null, dm_through bigint default 0, dm_conversation uuid default null) returns void
language plpgsql security invoker set search_path=public as $$
declare member uuid;
begin
 if mention_through<0 or dm_through<0 then raise exception 'invalid_cursor'; end if;
 update chat_room_mentions set read_at=now() where account_id=actor and room_slug=any(rooms) and read_at is null and seq<=mention_through and (mention_id is null or id=mention_id);
 select id into member from longboard_chat_members where user_id=actor;
 if member is null or dm_through=0 then return; end if;
 update longboard_chat_conversations c set
 requester_read_seq=case when c.requester_id=member then greatest(c.requester_read_seq,least(dm_through,coalesce((select max(d.seq) from longboard_chat_direct_messages d where d.conversation_id=c.id),0))) else c.requester_read_seq end,
 recipient_read_seq=case when c.recipient_id=member then greatest(c.recipient_read_seq,least(dm_through,coalesce((select max(d.seq) from longboard_chat_direct_messages d where d.conversation_id=c.id),0))) else c.recipient_read_seq end
 where (c.requester_id=member or c.recipient_id=member) and (dm_conversation is null or c.id=dm_conversation);
end $$;
revoke all on function public.record_chat_room_mentions(),public.chat_activity_inbox(uuid,text[]),public.read_chat_activity(uuid,text[],bigint,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.record_chat_room_mentions(),public.chat_activity_inbox(uuid,text[]),public.read_chat_activity(uuid,text[],bigint,uuid,bigint,uuid) to service_role;
