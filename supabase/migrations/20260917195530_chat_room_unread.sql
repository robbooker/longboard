-- Channel read positions are independent of mention notifications.
alter table public.longboard_chat_messages add column unread_seq bigint generated always as identity;
create index chat_room_unread_seq_idx on public.longboard_chat_messages(room_slug, unread_seq);
create table public.chat_room_reads (
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 room_slug text not null check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements')),
 through_seq bigint not null default 0 check(through_seq >= 0),
 primary key(account_id,room_slug)
);
alter table public.chat_room_reads enable row level security;
revoke all on public.chat_room_reads from public,anon,authenticated;
grant select,insert,update on public.chat_room_reads to service_role;
grant usage,select on sequence public.longboard_chat_messages_unread_seq_seq to service_role;
-- Existing history starts read at rollout; subsequent messages count immediately.
insert into public.chat_room_reads(account_id,room_slug,through_seq)
select a.id,r.room_slug,r.through_seq from public.chat_accounts a cross join
(select room_slug,max(unread_seq) through_seq from public.longboard_chat_messages group by room_slug) r;

create function public.chat_room_unread(actor uuid, rooms text[])
returns jsonb language sql stable security invoker set search_path=public as $$
 with me as (select id from public.longboard_chat_members where user_id=actor), counts as (
 select room.room_slug,
 (select count(*) from public.longboard_chat_messages m
  where m.room_slug=room.room_slug and m.unread_seq>coalesce(r.through_seq,0)
  and m.member_id is distinct from (select id from me)) unread,
 (select m.unread_seq from public.longboard_chat_messages m
  where m.room_slug=room.room_slug order by m.unread_seq desc limit 1) through
 from (select distinct unnest(rooms) room_slug) room
 left join public.chat_room_reads r on r.account_id=actor and r.room_slug=room.room_slug
 ) select jsonb_build_object('roomMessageCounts',coalesce(jsonb_object_agg(room_slug,unread),'{}'::jsonb),
 'roomMessageThrough',coalesce(jsonb_object_agg(room_slug,coalesce(through,0)),'{}'::jsonb)) from counts;
$$;
create function public.read_chat_room(actor uuid, room text, through_seq bigint)
returns void language sql security invoker set search_path=public as $$
 insert into public.chat_room_reads(account_id,room_slug,through_seq)
 select actor,room,least(greatest(through_seq,0),coalesce(max(unread_seq),0))
 from public.longboard_chat_messages where room_slug=room
 on conflict(account_id,room_slug) do update
 set through_seq=greatest(chat_room_reads.through_seq,excluded.through_seq);
$$;
revoke all on function public.chat_room_unread(uuid,text[]), public.read_chat_room(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.chat_room_unread(uuid,text[]), public.read_chat_room(uuid,text,bigint) to service_role;
