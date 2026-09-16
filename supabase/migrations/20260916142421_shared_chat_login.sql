-- Chat identities are separate from Longboard product profiles/auth users.
-- Existing LB IDs are retained so message authorship and inboxes remain stable.
create table public.chat_accounts (
  id uuid primary key default gen_random_uuid(),
  longboard_user_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
insert into public.chat_accounts(id,longboard_user_id)
select id,id from public.profiles;

create table public.chat_provider_identities (
  provider text not null check (provider = 'shortscout'),
  subject uuid not null,
  account_id uuid not null references public.chat_accounts(id) on delete cascade,
  membership_level text not null check (membership_level in ('monthly','annual','lifetime','mastermind')),
  verified_at timestamptz not null default now(),
  primary key(provider,subject),
  unique(account_id,provider)
);

-- Only hashes of browser secrets/codes are stored. No provider tokens/passwords.
create table public.chat_login_requests (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  link_user_id uuid references auth.users(id) on delete cascade,
  return_room text not null check (return_room in ('main','social','shortscout')),
  popout boolean not null default false,
  subject uuid,
  membership_level text check (membership_level in ('monthly','annual','lifetime','mastermind')),
  code_hash text unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  check ((subject is null and membership_level is null and code_hash is null)
    or (subject is not null and membership_level is not null and code_hash is not null))
);
create index chat_login_requests_expiry_idx on public.chat_login_requests(expires_at);

create table public.chat_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.chat_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index chat_sessions_account_idx on public.chat_sessions(account_id);
create index chat_sessions_expiry_idx on public.chat_sessions(expires_at);

-- Intentionally no browser grants/policies: only authenticated server handlers
-- may handle these records after verifying the provider session/browser proof.
alter table public.chat_accounts enable row level security;
alter table public.chat_provider_identities enable row level security;
alter table public.chat_login_requests enable row level security;
alter table public.chat_sessions enable row level security;
revoke all on public.chat_accounts,public.chat_provider_identities,public.chat_login_requests,public.chat_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.chat_accounts,public.chat_provider_identities,public.chat_login_requests,public.chat_sessions to service_role;

-- Called only by the server after matching the HTTP-only browser state cookie.
-- The row lock makes code consumption and identity binding one transaction.
create function public.consume_chat_login(
 p_state_hash text, p_code_hash text, p_challenge text,
 p_link_user_id uuid, p_session_hash text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.chat_login_requests; a uuid; existing_account uuid;
begin
 select * into r from public.chat_login_requests where state_hash=p_state_hash for update;
 if not found or r.consumed_at is not null or r.expires_at<=now()
   or r.code_hash is null or p_code_hash is null or p_challenge is null
   or r.code_hash<>p_code_hash or r.challenge<>p_challenge
   or r.link_user_id is distinct from p_link_user_id then
   raise exception 'invalid_login_handoff';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-provider:shortscout:'||r.subject::text,0));
 select account_id into existing_account from public.chat_provider_identities
 where provider='shortscout' and subject=r.subject;
 if r.link_user_id is not null then
   if not exists(select 1 from public.profiles where id=r.link_user_id) then
     raise exception 'longboard_membership_required';
   end if;
   insert into public.chat_accounts(id,longboard_user_id) values(r.link_user_id,r.link_user_id)
     on conflict(longboard_user_id) do nothing;
   select id into a from public.chat_accounts where longboard_user_id=r.link_user_id;
   if existing_account is not null and existing_account<>a then
     raise exception 'identity_already_linked';
   end if;
 else
   a:=existing_account;
   if a is null then insert into public.chat_accounts default values returning id into a; end if;
 end if;
 insert into public.chat_provider_identities(provider,subject,account_id,membership_level)
 values('shortscout',r.subject,a,r.membership_level)
 on conflict(provider,subject) do update set membership_level=excluded.membership_level,verified_at=now();
 insert into public.chat_sessions(token_hash,account_id,expires_at)
 values(p_session_hash,a,now()+interval '12 hours');
 update public.chat_login_requests set consumed_at=now() where state_hash=p_state_hash;
 return jsonb_build_object('accountId',a,'room',r.return_room,'popout',r.popout);
end;
$$;
revoke all on function public.consume_chat_login(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_chat_login(text,text,text,uuid,text) to service_role;

-- Canonical chat IDs can belong to either membership provider.
alter table public.longboard_chat_members drop constraint longboard_chat_members_user_id_fkey;
alter table public.longboard_chat_members add constraint longboard_chat_members_user_id_fkey
 foreign key(user_id) references public.chat_accounts(id) on delete cascade;
alter table public.longboard_chat_search_budget drop constraint longboard_chat_search_budget_user_id_fkey;
alter table public.longboard_chat_search_budget add constraint longboard_chat_search_budget_user_id_fkey
 foreign key(user_id) references public.chat_accounts(id) on delete cascade;

create function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room='main' then exists(select 1 from public.profiles where id=p_account)
 when p_room='social' then exists(select 1 from public.profiles where id=p_account)
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 when p_room='shortscout' then exists(select 1 from public.profiles where id=p_account and role='admin')
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 else false end;
$$;
revoke all on function public.chat_account_has_room(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_account_has_room(uuid,text) to service_role;

create or replace function public.longboard_chat_link_member(p_user_id uuid, p_name text, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.longboard_chat_members; g public.longboard_chat_guests;
begin
  if not public.chat_account_has_room(p_user_id,'social') then raise exception 'profile_required'; end if;
  insert into public.chat_accounts(id,longboard_user_id) select id,id from public.profiles where id=p_user_id on conflict do nothing;
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

create or replace function public.longboard_chat_dm_action(p_user_id uuid, p_action text, p_target uuid default null, p_body text default null, p_client_id uuid default null, p_value boolean default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid; other uuid; c public.longboard_chat_conversations;
  msg public.longboard_chat_direct_messages; allowed boolean; latest bigint;
begin
  select id into actor from public.longboard_chat_members where user_id=p_user_id;
  if actor is null or not public.chat_account_has_room(p_user_id,'social') then raise exception 'member_required'; end if;
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

-- Guard service-side writes for every room, including SS-only attempts at LB.
create or replace function public.enforce_shortscout_chat_admin() returns trigger
language plpgsql security invoker set search_path=public as $$
declare target_room text; target_member uuid; account uuid;
begin
 if tg_table_name='longboard_chat_messages' then
  if new.bot_slug is not null then return new; end if;
  target_room:=new.room_slug; target_member:=new.member_id;
 else
  select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
  target_member:=new.guest_id;
 end if;
 select user_id into account from public.longboard_chat_members where id=target_member;
 if account is null or not public.chat_account_has_room(account,target_room) then
   raise exception 'chat_room_forbidden';
 end if;
 return new;
end; $$;

grant execute on function public.search_longboard_chat(text,text,timestamptz,uuid),
 public.longboard_chat_search_context(uuid),
 public.search_longboard_chat_semantic(text,extensions.vector,text) to service_role;
