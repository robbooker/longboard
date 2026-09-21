-- Additive broadcast channel. Existing member rooms and writer rules are preserved.
alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers'));
insert into public.longboard_chat_room_state(id,room_slug) values(6,'gainers');
alter table public.chat_room_reads drop constraint chat_room_reads_room_slug_check;
alter table public.chat_room_reads add constraint chat_room_reads_room_slug_check check(room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers'));
alter table public.chat_favorites drop constraint chat_favorites_room_slug_check;
alter table public.chat_favorites add constraint chat_favorites_room_slug_check check(room_slug is null or room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers'));

create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','ss-announcements','gainers') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
  join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers') then exists(select 1 from public.profiles where id=p_account)
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and provider='shortscout' and membership_level in ('monthly','annual','lifetime','mastermind') and verified_at>now()-interval '12 hours')
 when p_room in ('shortscout','ss-announcements') then exists(select 1 from public.chat_provider_identities where account_id=p_account and provider='shortscout' and membership_level='mastermind' and verified_at>now()-interval '12 hours')
 else false end;
$$;
revoke all on function public.chat_account_has_room(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_account_has_room(uuid,text) to service_role;
-- Authoritative profile role grants only the six public rooms. Reactions already
-- require a visible message through their existing RLS policy.
alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements','gainers')) or
 room_slug in ('social','gainers') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));

-- Authorized room directory. Presence is advisory UI state, never membership proof.
create or replace function public.longboard_chat_room_members(p_user_id uuid,p_room text,p_cursor uuid default null,p_query text default '')
returns table(id uuid,display_name text) language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements','gainers') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 then raise exception 'invalid_query'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name from public.longboard_chat_members m
 where (p_cursor is null or m.id>p_cursor)
   and strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
 -- UUID keysets remain stable across name edits; the UI sorts the loaded names.
 order by m.id limit 51;
end $$;
revoke all on function public.longboard_chat_room_members(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_members(uuid,text,uuid,text) to service_role;

-- Count the same visible membership set as the room directory, before search or pagination.
create or replace function public.longboard_chat_room_member_count(p_user_id uuid,p_room text)
returns bigint language plpgsql stable security invoker set search_path='' as $$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements','gainers') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $$;
revoke all on function public.longboard_chat_room_member_count(uuid,text) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_member_count(uuid,text) to service_role;

-- Presence IDs are ordering hints only. Authorization always uses verified room membership.
create or replace function public.longboard_chat_room_members_ordered(
 p_user_id uuid,p_room text,p_query text default '',p_online_ids uuid[] default '{}',
 p_after_rank integer default null,p_after_name text default null,p_after_id uuid default null
) returns table(id uuid,display_name text,sort_rank integer,sort_name text)
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','ss-announcements','gainers') then raise exception 'invalid_room'; end if;
 if p_query is null or char_length(p_query)>28 or p_online_ids is null or cardinality(p_online_ids)>5000 then raise exception 'invalid_query'; end if;
 if ((p_after_rank is null and p_after_name is null and p_after_id is null) or
   (p_after_rank in (0,1) and p_after_name is not null and p_after_id is not null)) is not true then raise exception 'invalid_cursor'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 return query
 select m.id,m.display_name,case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name)
 from public.longboard_chat_members m
 where strpos(lower(m.display_name),lower(btrim(p_query)))>0
   and public.chat_account_has_room(m.user_id,p_room)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor))
   and (p_after_id is null or
     (case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id) >
     (p_after_rank,p_after_name collate "C",p_after_id))
 order by case when m.id=any(p_online_ids) then 0 else 1 end,lower(m.display_name) collate "C",m.id
 limit 51;
end $$;
revoke all on function public.longboard_chat_room_members_ordered(uuid,text,text,uuid[],integer,text,uuid) from public,anon,authenticated;
grant execute on function public.longboard_chat_room_members_ordered(uuid,text,text,uuid[],integer,text,uuid) to service_role;

-- Dedicated source ledger. No member/anonymous reads or writes; RLS defense in depth.
create table public.chat_gainers_sources (
 channel_id text not null check(channel_id ~ '^-?[0-9]+$'),
 source_message_id bigint not null check(source_message_id between 1 and 9007199254740991),
 message_id uuid not null unique default gen_random_uuid(),
 posted_at timestamptz not null,
 body text not null check(char_length(body) between 1 and 4096 and char_length(btrim(body))>0),
 received_at timestamptz not null default now(),
 primary key(channel_id,source_message_id),
 foreign key(message_id) references public.longboard_chat_messages(id) deferrable initially deferred
);
alter table public.chat_gainers_sources enable row level security;
revoke all on public.chat_gainers_sources from public,anon,authenticated,service_role;
grant select,insert on public.chat_gainers_sources to service_role;
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers')
);
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_body_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_body_check check(
 char_length(btrim(body)) <= case when room_slug='gainers' then 4096 else 600 end
 and (char_length(btrim(body))>=1 or cardinality(attachment_ids)>0));

-- A Gainers row must originate in the transaction's source ledger reservation.
-- This also denies service-side member/admin posts, replies and updates.
create function public.enforce_chat_gainers_source() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.room_slug='gainers' then raise exception 'gainers_read_only'; end if;
 if new.room_slug='gainers' then
  if tg_op<>'INSERT' or new.member_id is not null or new.guest_id is not null or new.bot_slug is distinct from 'gainers'
   or new.author_label<>'Gainers' or new.reply_to_id is not null or cardinality(new.attachment_ids)>0
   or not exists(select 1 from public.chat_gainers_sources s where s.message_id=new.id and s.body=new.body and s.posted_at=new.created_at)
  then raise exception 'gainers_read_only'; end if;
 end if;
 -- A forged cross-room reply cannot turn a broadcast into a conversation.
 if new.reply_to_id is not null and exists(select 1 from public.longboard_chat_messages where id=new.reply_to_id and room_slug='gainers') then raise exception 'gainers_read_only'; end if;
 return new;
end $$;
revoke all on function public.enforce_chat_gainers_source() from public,anon,authenticated;
grant execute on function public.enforce_chat_gainers_source() to service_role;
create trigger chat_gainers_source_guard before insert or update on public.longboard_chat_messages for each row execute function public.enforce_chat_gainers_source();

create function public.ingest_chat_gainers_alert(p_channel text,p_source_id bigint,p_posted_at timestamptz,p_body text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.chat_gainers_sources; inserted integer;
begin
 if p_channel is null or p_channel !~ '^-?[0-9]+$' or length(p_channel)>32 or p_source_id is null or p_source_id not between 1 and 9007199254740991
  or p_posted_at is null or p_posted_at>now()+interval '5 minutes' or p_body is null or char_length(p_body) not between 1 and 4096 or char_length(btrim(p_body))=0
 then raise exception 'invalid_gainers_alert'; end if;
 insert into public.chat_gainers_sources(channel_id,source_message_id,posted_at,body) values(p_channel,p_source_id,p_posted_at,p_body)
 on conflict(channel_id,source_message_id) do nothing;
 get diagnostics inserted=row_count;
 select * into source from public.chat_gainers_sources where channel_id=p_channel and source_message_id=p_source_id;
 if source.body<>p_body or source.posted_at<>p_posted_at then raise exception 'gainers_source_conflict'; end if;
 if inserted=1 then
  insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug,created_at)
  values(source.message_id,'gainers','Gainers',p_body,'gainers',p_posted_at);
 end if;
 return jsonb_build_object('messageId',source.message_id,'duplicate',inserted=0);
end $$;
revoke all on function public.ingest_chat_gainers_alert(text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.ingest_chat_gainers_alert(text,bigint,timestamptz,text) to service_role;
