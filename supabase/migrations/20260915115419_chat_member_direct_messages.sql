-- Account ownership is private. Public messages expose only the opaque member ID.
create table public.longboard_chat_members (
  id uuid primary key references public.longboard_chat_guests(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 28),
  accepts_requests boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index longboard_chat_member_name_idx on public.longboard_chat_members(lower(display_name));
alter table public.longboard_chat_messages add column member_id uuid references public.longboard_chat_members(id) on delete set null;
create index longboard_chat_messages_member_idx on public.longboard_chat_messages(member_id) where member_id is not null;

create table public.longboard_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  recipient_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  requester_read_seq bigint not null default 0,
  recipient_read_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index longboard_chat_conversation_pair_idx on public.longboard_chat_conversations(least(requester_id,recipient_id), greatest(requester_id,recipient_id));
create index longboard_chat_conversation_requester_idx on public.longboard_chat_conversations(requester_id, updated_at desc);
create index longboard_chat_conversation_recipient_idx on public.longboard_chat_conversations(recipient_id, updated_at desc);

create table public.longboard_chat_direct_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  conversation_id uuid not null references public.longboard_chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(sender_id,client_id)
);
create index longboard_chat_dm_conversation_seq_idx on public.longboard_chat_direct_messages(conversation_id,seq desc);
create index longboard_chat_dm_sender_created_idx on public.longboard_chat_direct_messages(sender_id,created_at desc);

create table public.longboard_chat_blocks (
  blocker_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  blocked_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check (blocker_id <> blocked_id)
);
create index longboard_chat_blocks_blocked_idx on public.longboard_chat_blocks(blocked_id);
create table public.longboard_chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  conversation_id uuid not null references public.longboard_chat_conversations(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(reporter_id,conversation_id)
);
create index longboard_chat_reports_conversation_idx on public.longboard_chat_reports(conversation_id);

alter table public.longboard_chat_members enable row level security;
alter table public.longboard_chat_conversations enable row level security;
alter table public.longboard_chat_direct_messages enable row level security;
alter table public.longboard_chat_blocks enable row level security;
alter table public.longboard_chat_reports enable row level security;
revoke all on public.longboard_chat_members, public.longboard_chat_conversations, public.longboard_chat_direct_messages, public.longboard_chat_blocks, public.longboard_chat_reports from anon, authenticated;
grant select on public.longboard_chat_members, public.longboard_chat_conversations, public.longboard_chat_direct_messages, public.longboard_chat_blocks to authenticated;
grant all on public.longboard_chat_members, public.longboard_chat_conversations, public.longboard_chat_direct_messages, public.longboard_chat_blocks, public.longboard_chat_reports to service_role;
grant usage, select on sequence public.longboard_chat_direct_messages_seq_seq to service_role;

create policy "members read own identity" on public.longboard_chat_members for select to authenticated using (user_id = (select auth.uid()));
create policy "participants read conversations" on public.longboard_chat_conversations for select to authenticated using (
  requester_id in (select id from public.longboard_chat_members where user_id = (select auth.uid()))
  or recipient_id in (select id from public.longboard_chat_members where user_id = (select auth.uid()))
);
create policy "participants read private messages" on public.longboard_chat_direct_messages for select to authenticated using (
  conversation_id in (select id from public.longboard_chat_conversations)
);
create policy "members read own blocks" on public.longboard_chat_blocks for select to authenticated using (
  blocker_id in (select id from public.longboard_chat_members where user_id = (select auth.uid()))
);

-- Invoker functions are server-only. API routes derive p_user_id from verified
-- Supabase auth, never from client input. No client has EXECUTE or write grants.
create function public.longboard_chat_link_member(p_user_id uuid, p_name text, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.longboard_chat_members; g public.longboard_chat_guests;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'profile_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('chat-member:' || p_user_id::text,0));
  select * into m from public.longboard_chat_members where user_id = p_user_id;
  if found then return to_jsonb(m); end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 28 then raise exception 'invalid_display_name'; end if;
  if p_token_hash is not null then
    select * into g from public.longboard_chat_guests where token_hash = p_token_hash for update;
  end if;
  if g.id is not null and exists(select 1 from public.longboard_chat_members where id=g.id) then
    raise exception 'identity_already_linked';
  end if;
  if g.id is null then
    insert into public.longboard_chat_guests(token_hash,display_name)
    values(replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),btrim(p_name)) returning * into g;
  else
    -- Retire the guest credential. It can no longer operate an account identity.
    update public.longboard_chat_guests set token_hash=replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), display_name=btrim(p_name), updated_at=now() where id=g.id;
  end if;
  insert into public.longboard_chat_members(id,user_id,display_name) values(g.id,p_user_id,btrim(p_name)) returning * into m;
  return to_jsonb(m);
end;
$$;
revoke all on function public.longboard_chat_link_member(uuid,text,text) from public, anon, authenticated;
grant execute on function public.longboard_chat_link_member(uuid,text,text) to service_role;

create function public.longboard_chat_dm_action(p_user_id uuid, p_action text, p_target uuid default null, p_body text default null, p_client_id uuid default null, p_value boolean default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid; other uuid; c public.longboard_chat_conversations;
  msg public.longboard_chat_direct_messages; allowed boolean; latest bigint;
begin
  select id into actor from public.longboard_chat_members where user_id=p_user_id;
  if actor is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'member_required'; end if;
  -- Serialize a sender's rate limits across tabs/devices.
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:' || actor::text,0));
  if p_action='settings' then
    if p_value is null then raise exception 'invalid_settings'; end if;
    update public.longboard_chat_members set accepts_requests=p_value where id=actor;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='request' then other:=p_target;
  else
    select * into c from public.longboard_chat_conversations where id=p_target and (requester_id=actor or recipient_id=actor);
    if not found then raise exception 'conversation_not_found'; end if;
    other:=case when c.requester_id=actor then c.recipient_id else c.requester_id end;
  end if;
  if other is null or other=actor then raise exception 'invalid_recipient'; end if;
  -- Requests in both directions, blocks, acceptance and sends use one pair lock.
  perform pg_advisory_xact_lock(hashtextextended('chat-dm-pair:' || least(actor,other)::text || ':' || greatest(actor,other)::text,0));
  if p_action='request' then
    select * into c from public.longboard_chat_conversations where least(requester_id,recipient_id)=least(actor,other) and greatest(requester_id,recipient_id)=greatest(actor,other);
    if found then return jsonb_build_object('conversationId',c.id); end if;
  else
    select * into c from public.longboard_chat_conversations where id=p_target for update;
  end if;
  if p_action='block' then
    insert into public.longboard_chat_blocks(blocker_id,blocked_id) values(actor,other) on conflict do nothing;
    update public.longboard_chat_conversations set updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='unblock' then
    delete from public.longboard_chat_blocks where blocker_id=actor and blocked_id=other;
    update public.longboard_chat_conversations set updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='report' then
    if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then raise exception 'invalid_report'; end if;
    insert into public.longboard_chat_reports(reporter_id,conversation_id,reason) values(actor,c.id,btrim(p_body))
      on conflict(reporter_id,conversation_id) do update set reason=excluded.reason;
    return jsonb_build_object('conversationId',c.id);
  elsif p_action='read' then
    -- Acknowledge only a message actually rendered by this client, never unseen arrivals.
    select seq into latest from public.longboard_chat_direct_messages where id=p_client_id and conversation_id=c.id;
    if latest is null then raise exception 'message_not_found'; end if;
    update public.longboard_chat_conversations set
      requester_read_seq=case when requester_id=actor then greatest(requester_read_seq,latest) else requester_read_seq end,
      recipient_read_seq=case when recipient_id=actor then greatest(recipient_read_seq,latest) else recipient_read_seq end
    where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if exists(select 1 from public.longboard_chat_blocks where (blocker_id=actor and blocked_id=other) or (blocker_id=other and blocked_id=actor)) then raise exception 'conversation_unavailable'; end if;
  if p_action in ('accept','decline') then
    if actor<>c.recipient_id or c.status<>'pending' then raise exception 'request_not_pending'; end if;
    update public.longboard_chat_conversations set status=case when p_action='accept' then 'accepted' else 'declined' end, updated_at=now() where id=c.id;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if p_action not in ('request','send') then raise exception 'invalid_action'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 or p_client_id is null then raise exception 'invalid_message'; end if;
  if p_action='send' and c.status<>'accepted' then raise exception 'request_not_accepted'; end if;
  select * into msg from public.longboard_chat_direct_messages where sender_id=actor and client_id=p_client_id;
  if found then
    if msg.conversation_id is distinct from c.id then raise exception 'invalid_client_id'; end if;
    return jsonb_build_object('conversationId',c.id);
  end if;
  if (select count(*) from public.longboard_chat_direct_messages where sender_id=actor and created_at>now()-interval '10 minutes')>=60 then raise exception 'rate_limited'; end if;
  if p_action='request' then
    select accepts_requests into allowed from public.longboard_chat_members where id=other for share;
    if not coalesce(allowed,false) then raise exception 'requests_unavailable'; end if;
    if (select count(*) from public.longboard_chat_conversations where requester_id=actor and created_at>now()-interval '1 day')>=10 then raise exception 'request_rate_limited'; end if;
    insert into public.longboard_chat_conversations(requester_id,recipient_id) values(actor,other) returning * into c;
  end if;
  insert into public.longboard_chat_direct_messages(conversation_id,sender_id,client_id,body) values(c.id,actor,p_client_id,btrim(p_body)) returning * into msg;
  update public.longboard_chat_conversations set updated_at=now(),
    requester_read_seq=case when requester_id=actor then msg.seq else requester_read_seq end,
    recipient_read_seq=case when recipient_id=actor then msg.seq else recipient_read_seq end
  where id=c.id;
  return jsonb_build_object('conversationId',c.id);
end;
$$;
revoke all on function public.longboard_chat_dm_action(uuid,text,uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.longboard_chat_dm_action(uuid,text,uuid,text,uuid,boolean) to service_role;

alter publication supabase_realtime add table public.longboard_chat_conversations;
alter publication supabase_realtime add table public.longboard_chat_direct_messages;

create function public.longboard_chat_inbox(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(item order by updated_at desc),'[]'::jsonb) from (
    select c.updated_at, jsonb_build_object(
      'id',c.id, 'status',c.status, 'incoming',c.recipient_id=me.id,
      'otherId',other.id, 'otherName',other.display_name,
      'blockedByMe',exists(select 1 from public.longboard_chat_blocks b where b.blocker_id=me.id and b.blocked_id=other.id),
      'unavailable',exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)),
      'lastBody',(select d.body from public.longboard_chat_direct_messages d where d.conversation_id=c.id order by d.seq desc limit 1),
      'updatedAt',c.updated_at,
      'unread',case when c.status='declined' then 0 else (select count(*) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end) end
    ) as item
    from public.longboard_chat_members me
    join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
    join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
    where me.user_id=p_user_id
  ) conversations;
$$;
revoke all on function public.longboard_chat_inbox(uuid) from public,anon,authenticated;
grant execute on function public.longboard_chat_inbox(uuid) to service_role;
