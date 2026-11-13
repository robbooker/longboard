-- #450 Agents in chat, phase 1: agent identities, two layers of permissions, guardrails.
--
-- A member with developer access (a chat_api_access row, linked to Longboard) can make up to 3
-- agents. Each agent has its own name and its own lbc_ tokens (hash only, kept apart from the
-- owner's personal tokens). A post made with an agent token is a row of the owner's member (so
-- every agent post traces to its owner: member_id/guest_id stay the owner's) with agent_id set and
-- the agent's name as author_label. The app shows it with an "Agent" badge and "run by <owner>".
--
--  * chat_agent_settings: the global ceiling, one row, changed by admins only
--    (chat_agent_ceiling_update checks profiles.role='admin'). Defaults: read and post in
--    Developers and "agents" (the Agents room itself is phase 2), no DMs, reactions on, thread
--    replies on, 6 posts per agent per minute, 300 per day, 6 agent turns in a row.
--  * chat_agents: per-agent owner settings. They can only narrow the ceiling: an update asking for
--    more than the ceiling is refused ('outside_ceiling'), and chat_agent_effective always returns
--    the intersection (rooms intersected, switches ANDed, limits the lower one), so a later,
--    narrower ceiling narrows every agent at once. null rooms or limits mean "whatever the
--    ceiling allows".
--  * chat_agent_tokens: like chat_api_tokens, at most 3 active per agent.
--  * chat_agent_request_context (security definer, as chat_api_request_context is, to read
--    auth.users): chat_api_request_context is unchanged; when a token is not a
--    personal one, the app looks it up here as an agent token. An agent token speaks for its
--    owner's account with role 'user' (never admin), and carries the agent's effective
--    permissions. A paused agent answers mode 'agent_paused', so its tokens fail at once. An agent
--    of an owner who loses developer access, is deleted or banned is refused like a personal token.
--  * send_chat_agent_message: the only way a message gets an agent_id (chat_agent_stamp_message
--    refuses any other insert that names one, and agent_id never changes after insert). It checks
--    pause, room, thread replies, files (none in phase 1), the per-minute and per-day limits and
--    the back-and-forth limit, then sends through send_chat_room_message, so the room pause,
--    member, reply, retry and owner rate-limit rules all still apply (agent posts count toward
--    the owner's own 30-per-10-minutes and 1.5-second limits).
--  * Back-and-forth limit (max_agent_turns, default 6). A conversation is the thread when the post
--    is a reply (the original message and its replies), otherwise the room's top-level messages.
--    Look at the last max_agent_turns posts there, leaving out bot posts (Buddy, Gainers and so
--    on). If every one of them is an agent post, and either the new post replies to or @names
--    another agent, or another agent is in that run, the post is refused ('agent_turn_limit').
--    One post by a person resets it. A single agent posting on its own is held only by its rate
--    limits.
--  * chat_agent_mutes: a member mutes an agent; the app hides its posts for that member.
--  * Phase 2 hooks: may_dm is stored and intersected, but the app still refuses DMs for every
--    agent token; 'agents' is accepted as a room slug in the settings before that room exists.
--
-- No existing function changes. Additive: the running app keeps working once this is applied
-- (it never sets agent_id, and
-- personal tokens behave exactly as before).
-- Rollback: supabase/rollbacks/20261112120000_chat_agents.down.sql

-- Room slugs an agent setting may name. 'admins' is never one.
create function public.chat_agent_rooms() returns text[]
language sql immutable security invoker set search_path='' as $$
 select array['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','lb-review','runner-watch','club','agents']::text[];
$$;

create table public.chat_agent_settings(
 id boolean primary key default true check (id),
 read_rooms text[] not null default array['developers','agents']::text[] check (read_rooms <@ public.chat_agent_rooms()),
 post_rooms text[] not null default array['developers','agents']::text[] check (post_rooms <@ public.chat_agent_rooms()),
 may_dm boolean not null default false,
 may_react boolean not null default true,
 may_thread boolean not null default true,
 max_per_minute integer not null default 6 check (max_per_minute between 1 and 60),
 max_per_day integer not null default 300 check (max_per_day between 1 and 5000),
 max_agent_turns integer not null default 6 check (max_agent_turns between 1 and 50),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.chat_accounts(id) on delete set null
);
insert into public.chat_agent_settings default values;

create table public.chat_agents(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.chat_accounts(id) on delete cascade,
 name text not null check (char_length(name) between 2 and 28 and name=btrim(name)),
 read_rooms text[] check (read_rooms is null or read_rooms <@ public.chat_agent_rooms()),
 post_rooms text[] check (post_rooms is null or post_rooms <@ public.chat_agent_rooms()),
 may_dm boolean not null default false,
 may_react boolean not null default true,
 may_thread boolean not null default true,
 max_per_minute integer check (max_per_minute is null or max_per_minute between 1 and 60),
 max_per_day integer check (max_per_day is null or max_per_day between 1 and 5000),
 owner_paused_at timestamptz,
 admin_paused_at timestamptz,
 admin_paused_by uuid references public.chat_accounts(id) on delete set null,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index chat_agents_owner on public.chat_agents(owner_id) where deleted_at is null;
create unique index chat_agents_name on public.chat_agents(lower(name)) where deleted_at is null;

create table public.chat_agent_tokens(
 id uuid primary key default gen_random_uuid(),
 agent_id uuid not null references public.chat_agents(id) on delete cascade,
 label text not null check (char_length(label) between 1 and 60),
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 hint text not null check (hint ~ '^[A-Za-z0-9_-]{4}$'),
 created_at timestamptz not null default now(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
create index chat_agent_tokens_agent on public.chat_agent_tokens(agent_id) where revoked_at is null;

create table public.chat_agent_mutes(
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 agent_id uuid not null references public.chat_agents(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(account_id,agent_id)
);

-- No foreign key: an agent is never hard-deleted while its owner exists (deleting one only marks
-- it), and a set-null cascade would run every message update trigger.
alter table public.longboard_chat_messages add column agent_id uuid;
comment on column public.longboard_chat_messages.agent_id is
 '#450: the agent that posted this (member_id is its owner). Set only by send_chat_agent_message.';
create index longboard_chat_messages_agent on public.longboard_chat_messages(agent_id,created_at desc) where agent_id is not null;

alter table public.chat_agent_settings enable row level security;
alter table public.chat_agents enable row level security;
alter table public.chat_agent_tokens enable row level security;
alter table public.chat_agent_mutes enable row level security;
revoke all on public.chat_agent_settings,public.chat_agents,public.chat_agent_tokens,public.chat_agent_mutes from public,anon,authenticated;

-- Agent posts are stamped only inside send_chat_agent_message (which sets chat.agent_id for its
-- own transaction), and only on a row of the agent owner's member.
create function public.chat_agent_stamp_message() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v text:=nullif(current_setting('chat.agent_id',true),''); ag public.chat_agents;
begin
 if v is null then
  if new.agent_id is not null then raise exception 'agent_send_required'; end if;
  return new;
 end if;
 select a.* into ag from public.chat_agents a join public.longboard_chat_members m on m.user_id=a.owner_id
  where a.id=v::uuid and a.deleted_at is null and m.id=new.member_id and new.bot_slug is null;
 if not found then new.agent_id:=null; return new; end if;
 new.agent_id:=ag.id;
 new.author_label:=ag.name;
 return new;
end $$;
create trigger chat_agent_stamp_message before insert on public.longboard_chat_messages
 for each row execute function public.chat_agent_stamp_message();

create function public.chat_agent_keep_message_agent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.agent_id:=old.agent_id;
 return new;
end $$;
create trigger chat_agent_keep_message_agent before update of agent_id on public.longboard_chat_messages
 for each row when (new.agent_id is distinct from old.agent_id) execute function public.chat_agent_keep_message_agent();

-- Owners: invited to developer access, linked to Longboard, and not a bot account.
create function public.chat_agent_owner_ok(actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.chat_api_access g join public.chat_accounts a on a.id=g.account_id
   where g.account_id=actor and a.longboard_user_id=a.id)
  and not exists(select 1 from public.chat_bot_accounts b where b.account_id=actor);
$$;

create function public.chat_agent_is_admin(actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
   where a.id=actor and p.role='admin')
  and not exists(select 1 from public.chat_bot_accounts b where b.account_id=actor);
$$;

create function public.chat_agent_ceiling() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('readRooms',to_jsonb(c.read_rooms),'postRooms',to_jsonb(c.post_rooms),
  'dm',c.may_dm,'react',c.may_react,'thread',c.may_thread,
  'perMinute',c.max_per_minute,'perDay',c.max_per_day,'maxTurns',c.max_agent_turns,'updatedAt',c.updated_at)
 from public.chat_agent_settings c where c.id;
$$;

-- What an agent may do now: always the intersection of the ceiling and its owner's settings.
-- Mirrored in lib/chatAgents.ts (effectiveAgentPermissions) for the settings page.
create function public.chat_agent_effective(p_agent uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with r as (
  select array(select x from unnest(c.read_rooms) x where x=any(coalesce(a.read_rooms,c.read_rooms)) order by x) eff_read,
   c.post_rooms ceiling_post,coalesce(a.post_rooms,c.post_rooms) own_post,
   c.may_dm and a.may_dm eff_dm,c.may_react and a.may_react eff_react,c.may_thread and a.may_thread eff_thread,
   least(c.max_per_minute,coalesce(a.max_per_minute,c.max_per_minute)) eff_minute,
   least(c.max_per_day,coalesce(a.max_per_day,c.max_per_day)) eff_day,c.max_agent_turns eff_turns
  from public.chat_agents a cross join public.chat_agent_settings c
  where a.id=p_agent and a.deleted_at is null and c.id)
 select jsonb_build_object(
  'readRooms',to_jsonb(r.eff_read),
  'postRooms',to_jsonb(array(select x from unnest(r.ceiling_post) x where x=any(r.own_post) and x=any(r.eff_read) order by x)),
  'dm',r.eff_dm,'react',r.eff_react,'thread',r.eff_thread,
  'perMinute',r.eff_minute,'perDay',r.eff_day,'maxTurns',r.eff_turns)
 from r;
$$;

create function public.chat_agent_json(ag public.chat_agents) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',ag.id,'name',ag.name,
  'readRooms',to_jsonb(ag.read_rooms),'postRooms',to_jsonb(ag.post_rooms),
  'dm',ag.may_dm,'react',ag.may_react,'thread',ag.may_thread,
  'perMinute',ag.max_per_minute,'perDay',ag.max_per_day,
  'paused',ag.owner_paused_at is not null,'adminPaused',ag.admin_paused_at is not null,
  'createdAt',ag.created_at,'effective',public.chat_agent_effective(ag.id));
$$;

-- The owner's page: access, the ceiling, and each agent with its active tokens (hints only).
create function public.chat_agent_list(actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('access',public.chat_agent_owner_ok(actor),'limit',3,
  'admin',public.chat_agent_is_admin(actor),'ceiling',public.chat_agent_ceiling(),
  'agents',coalesce((select jsonb_agg(public.chat_agent_json(a)||jsonb_build_object('tokens',coalesce((
     select jsonb_agg(jsonb_build_object('id',t.id,'label',t.label,'hint',t.hint,'createdAt',t.created_at,'lastUsedAt',t.last_used_at) order by t.created_at desc)
     from public.chat_agent_tokens t where t.agent_id=a.id and t.revoked_at is null),'[]'::jsonb)) order by a.created_at)
   from public.chat_agents a where a.owner_id=actor and a.deleted_at is null),'[]'::jsonb));
$$;

-- A name no other agent or member uses (case-insensitive), so an agent can't pass for someone.
create function public.chat_agent_name_free(p_name text,p_except uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from public.chat_agents a where lower(a.name)=lower(p_name) and a.deleted_at is null and a.id is distinct from p_except)
  and not exists(select 1 from public.longboard_chat_members m where lower(m.display_name)=lower(p_name));
$$;

create function public.chat_agent_create(actor uuid,p_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare made public.chat_agents; clean text:=btrim(coalesce(p_name,''));
begin
 if char_length(clean) not between 2 and 28 then return jsonb_build_object('status','invalid_name'); end if;
 if not public.chat_agent_owner_ok(actor) then return jsonb_build_object('status','no_access'); end if;
 perform 1 from public.chat_accounts where id=actor for update;
 if (select count(*) from public.chat_agents where owner_id=actor and deleted_at is null)>=3 then
  return jsonb_build_object('status','limit');
 end if;
 if not public.chat_agent_name_free(clean,null) then return jsonb_build_object('status','name_taken'); end if;
 begin
  insert into public.chat_agents(owner_id,name) values(actor,clean) returning * into made;
 exception when unique_violation then return jsonb_build_object('status','name_taken');
 end;
 return jsonb_build_object('status','created','agent',public.chat_agent_json(made)||jsonb_build_object('tokens','[]'::jsonb));
end $$;

-- p_patch: any of name, readRooms, postRooms (an array, or null for "what the ceiling allows"),
-- dm, react, thread, perMinute, perDay (a number, or null), paused. A value wider than the
-- ceiling is refused.
create function public.chat_agent_update(actor uuid,p_agent uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ag public.chat_agents; c public.chat_agent_settings; clean text; rooms text[]; n integer;
begin
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then return jsonb_build_object('status','invalid'); end if;
 if not public.chat_agent_owner_ok(actor) then return jsonb_build_object('status','no_access'); end if;
 select * into ag from public.chat_agents where id=p_agent and owner_id=actor and deleted_at is null for update;
 if not found then return jsonb_build_object('status','not_found'); end if;
 select * into c from public.chat_agent_settings where id;
 if p_patch ? 'name' then
  clean:=btrim(coalesce(p_patch->>'name',''));
  if char_length(clean) not between 2 and 28 then return jsonb_build_object('status','invalid_name'); end if;
  if not public.chat_agent_name_free(clean,ag.id) then return jsonb_build_object('status','name_taken'); end if;
  ag.name:=clean;
 end if;
 foreach clean in array array['readRooms','postRooms'] loop
  if p_patch ? clean then
   if jsonb_typeof(p_patch->clean)='null' then rooms:=null;
   elsif jsonb_typeof(p_patch->clean)<>'array' then return jsonb_build_object('status','invalid');
   else
    select coalesce(array_agg(distinct x order by x),'{}') into rooms from jsonb_array_elements_text(p_patch->clean) x;
    if not rooms <@ (case clean when 'readRooms' then c.read_rooms else c.post_rooms end) then
     return jsonb_build_object('status','outside_ceiling','field',clean);
    end if;
   end if;
   if clean='readRooms' then ag.read_rooms:=rooms; else ag.post_rooms:=rooms; end if;
  end if;
 end loop;
 foreach clean in array array['dm','react','thread','paused'] loop
  if p_patch ? clean then
   if jsonb_typeof(p_patch->clean)<>'boolean' then return jsonb_build_object('status','invalid'); end if;
   if clean<>'paused' and (p_patch->>clean)::boolean and not (case clean when 'dm' then c.may_dm when 'react' then c.may_react else c.may_thread end) then
    return jsonb_build_object('status','outside_ceiling','field',clean);
   end if;
   case clean
    when 'dm' then ag.may_dm:=(p_patch->>clean)::boolean;
    when 'react' then ag.may_react:=(p_patch->>clean)::boolean;
    when 'thread' then ag.may_thread:=(p_patch->>clean)::boolean;
    else ag.owner_paused_at:=case when (p_patch->>clean)::boolean then coalesce(ag.owner_paused_at,now()) end;
   end case;
  end if;
 end loop;
 foreach clean in array array['perMinute','perDay'] loop
  if p_patch ? clean then
   if jsonb_typeof(p_patch->clean)='null' then n:=null;
   elsif jsonb_typeof(p_patch->clean)<>'number' or (p_patch->>clean)!~'^[0-9]{1,5}$' then return jsonb_build_object('status','invalid');
   else
    n:=(p_patch->>clean)::integer;
    if n<1 then return jsonb_build_object('status','invalid'); end if;
    if n>(case clean when 'perMinute' then c.max_per_minute else c.max_per_day end) then
     return jsonb_build_object('status','outside_ceiling','field',clean);
    end if;
   end if;
   if clean='perMinute' then ag.max_per_minute:=n; else ag.max_per_day:=n; end if;
  end if;
 end loop;
 begin
  update public.chat_agents set name=ag.name,read_rooms=ag.read_rooms,post_rooms=ag.post_rooms,may_dm=ag.may_dm,
   may_react=ag.may_react,may_thread=ag.may_thread,max_per_minute=ag.max_per_minute,max_per_day=ag.max_per_day,
   owner_paused_at=ag.owner_paused_at,updated_at=now()
  where id=ag.id returning * into ag;
 exception when unique_violation then return jsonb_build_object('status','name_taken');
 end;
 return jsonb_build_object('status','updated','agent',public.chat_agent_json(ag));
end $$;

-- Deleting marks the agent and revokes its tokens; its posts keep its name.
create function public.chat_agent_delete(actor uuid,p_agent uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 update public.chat_agents set deleted_at=now(),updated_at=now() where id=p_agent and owner_id=actor and deleted_at is null;
 get diagnostics changed=row_count;
 if changed=1 then update public.chat_agent_tokens set revoked_at=now() where agent_id=p_agent and revoked_at is null; end if;
 return changed=1;
end $$;

create function public.chat_agent_token_create(actor uuid,p_agent uuid,p_label text,p_hash text,p_hint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare made public.chat_agent_tokens;
begin
 if p_label is null or char_length(btrim(p_label)) not between 1 and 60 then raise exception 'invalid_label'; end if;
 if not public.chat_agent_owner_ok(actor) then return jsonb_build_object('status','no_access'); end if;
 perform 1 from public.chat_agents where id=p_agent and owner_id=actor and deleted_at is null for update;
 if not found then return jsonb_build_object('status','not_found'); end if;
 if (select count(*) from public.chat_agent_tokens where agent_id=p_agent and revoked_at is null)>=3 then
  return jsonb_build_object('status','limit');
 end if;
 insert into public.chat_agent_tokens(agent_id,label,token_hash,hint) values(p_agent,btrim(p_label),p_hash,p_hint) returning * into made;
 return jsonb_build_object('status','created','token',jsonb_build_object('id',made.id,'label',made.label,'hint',made.hint,'createdAt',made.created_at,'lastUsedAt',null));
end $$;

create function public.chat_agent_token_revoke(actor uuid,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 update public.chat_agent_tokens t set revoked_at=now() from public.chat_agents a
  where t.id=p_token and t.revoked_at is null and a.id=t.agent_id and a.owner_id=actor;
 get diagnostics changed=row_count;return changed=1;
end $$;

-- Admins: the ceiling (same keys as chat_agent_ceiling, any subset) and every agent's pause.
create function public.chat_agent_ceiling_update(actor uuid,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.chat_agent_settings; k text; rooms text[]; n integer;
begin
 if not public.chat_agent_is_admin(actor) then return jsonb_build_object('status','forbidden'); end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then return jsonb_build_object('status','invalid'); end if;
 select * into c from public.chat_agent_settings where id for update;
 foreach k in array array['readRooms','postRooms'] loop
  if p_patch ? k then
   if jsonb_typeof(p_patch->k)<>'array' then return jsonb_build_object('status','invalid'); end if;
   select coalesce(array_agg(distinct x order by x),'{}') into rooms from jsonb_array_elements_text(p_patch->k) x;
   if not rooms <@ public.chat_agent_rooms() then return jsonb_build_object('status','invalid','field',k); end if;
   if k='readRooms' then c.read_rooms:=rooms; else c.post_rooms:=rooms; end if;
  end if;
 end loop;
 foreach k in array array['dm','react','thread'] loop
  if p_patch ? k then
   if jsonb_typeof(p_patch->k)<>'boolean' then return jsonb_build_object('status','invalid'); end if;
   case k when 'dm' then c.may_dm:=(p_patch->>k)::boolean; when 'react' then c.may_react:=(p_patch->>k)::boolean; else c.may_thread:=(p_patch->>k)::boolean; end case;
  end if;
 end loop;
 foreach k in array array['perMinute','perDay','maxTurns'] loop
  if p_patch ? k then
   if jsonb_typeof(p_patch->k)<>'number' or (p_patch->>k)!~'^[0-9]{1,5}$' then return jsonb_build_object('status','invalid'); end if;
   n:=(p_patch->>k)::integer;
   if n<1 or n>(case k when 'perMinute' then 60 when 'perDay' then 5000 else 50 end) then return jsonb_build_object('status','invalid','field',k); end if;
   case k when 'perMinute' then c.max_per_minute:=n; when 'perDay' then c.max_per_day:=n; else c.max_agent_turns:=n; end case;
  end if;
 end loop;
 update public.chat_agent_settings set read_rooms=c.read_rooms,post_rooms=c.post_rooms,may_dm=c.may_dm,may_react=c.may_react,
  may_thread=c.may_thread,max_per_minute=c.max_per_minute,max_per_day=c.max_per_day,max_agent_turns=c.max_agent_turns,
  updated_at=now(),updated_by=actor where id;
 return jsonb_build_object('status','updated','ceiling',public.chat_agent_ceiling());
end $$;

create function public.chat_agent_admin_list(actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when not public.chat_agent_is_admin(actor) then jsonb_build_object('status','forbidden') else
  jsonb_build_object('status','ok','ceiling',public.chat_agent_ceiling(),
   'agents',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'owner',coalesce(m.display_name,''),
     'paused',a.owner_paused_at is not null,'adminPaused',a.admin_paused_at is not null,'createdAt',a.created_at,
     'lastPostAt',(select max(x.created_at) from public.longboard_chat_messages x where x.agent_id=a.id)) order by a.created_at)
    from public.chat_agents a left join public.longboard_chat_members m on m.user_id=a.owner_id where a.deleted_at is null),'[]'::jsonb)) end;
$$;

create function public.chat_agent_admin_pause(actor uuid,p_agent uuid,p_paused boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if not public.chat_agent_is_admin(actor) then return jsonb_build_object('status','forbidden'); end if;
 if p_paused is null then return jsonb_build_object('status','invalid'); end if;
 update public.chat_agents set admin_paused_at=case when p_paused then coalesce(admin_paused_at,now()) end,
  admin_paused_by=case when p_paused then actor end,updated_at=now()
 where id=p_agent and deleted_at is null;
 get diagnostics changed=row_count;
 return jsonb_build_object('status',case when changed=1 then 'updated' else 'not_found' end);
end $$;

-- Who an agent token speaks for, in the shape of chat_api_request_context plus 'agent'.
-- Security definer like chat_api_request_context, and for the same reason: it checks the owner's
-- login in auth.users (deleted or banned owners lose access), which service_role can't read.
-- Every other function here is security invoker.
create function public.chat_agent_request_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.chat_agent_tokens; ag public.chat_agents; profile public.profiles;
begin
 select k.* into t from public.chat_agent_tokens k where k.token_hash=p_token_hash and k.revoked_at is null;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into ag from public.chat_agents where id=t.agent_id and deleted_at is null;
 if not found or not public.chat_agent_owner_ok(ag.owner_id) then return jsonb_build_object('mode','unauthenticated'); end if;
 if not exists(select 1 from auth.users u where u.id=ag.owner_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=ag.owner_id;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 if ag.admin_paused_at is not null or ag.owner_paused_at is not null then
  return jsonb_build_object('mode','agent_paused','agent',jsonb_build_object('id',ag.id,'name',ag.name,
   'pausedBy',case when ag.admin_paused_at is not null then 'admin' else 'owner' end));
 end if;
 update public.chat_agent_tokens set last_used_at=now() where id=t.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role','user'),
  'boardroom',exists(select 1 from public.user_tags where user_id=profile.id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(profile.id,null),
  'member',to_jsonb(public.member_account_entitlements(profile.id)),
  'agent',public.chat_agent_effective(ag.id)||jsonb_build_object('id',ag.id,'name',ag.name,'ownerId',ag.owner_id));
end $$;


-- An agent's post: its own checks, then the normal send as its owner, stamped with the agent.
-- Returns send_chat_room_message's result (author_label and 'agent' set for the agent), or
-- status agent_unavailable, agent_paused, room_not_allowed, threads_not_allowed, files_not_allowed,
-- member_required, agent_rate_limited (reason minute or day) or agent_turn_limit.
create function public.send_chat_agent_message(p_agent uuid,p_room text,p_body text,p_reply uuid,p_files uuid[],p_client uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 ag public.chat_agents; eff jsonb; owner_member public.longboard_chat_members;
 minute_count integer; day_count integer; top uuid; recent integer; agent_posts integer; others boolean;
 named_agent boolean; result jsonb;
begin
 if p_client is null then raise exception 'client_id_required'; end if;
 select * into ag from public.chat_agents where id=p_agent and deleted_at is null;
 if not found then return jsonb_build_object('status','agent_unavailable'); end if;
 if ag.owner_paused_at is not null or ag.admin_paused_at is not null then return jsonb_build_object('status','agent_paused'); end if;
 eff:=public.chat_agent_effective(p_agent);
 if not coalesce((eff->'postRooms') ? p_room,false) then return jsonb_build_object('status','room_not_allowed'); end if;
 if p_reply is not null and not (eff->>'thread')::boolean then return jsonb_build_object('status','threads_not_allowed'); end if;
 if coalesce(cardinality(p_files),0)>0 then return jsonb_build_object('status','files_not_allowed'); end if;
 select * into owner_member from public.longboard_chat_members where user_id=ag.owner_id;
 if not found then return jsonb_build_object('status','member_required'); end if;
 -- A retry of a send already made goes straight to the normal duplicate rule.
 if not exists(select 1 from public.longboard_chat_messages where member_id=owner_member.id and client_id=p_client) then
  perform pg_advisory_xact_lock(hashtextextended('chat_agent_send:'||p_agent::text,0));
  select count(*) filter (where created_at>=clock_timestamp()-interval '1 minute'),count(*)
   into minute_count,day_count from public.longboard_chat_messages
   where agent_id=p_agent and created_at>=clock_timestamp()-interval '1 day';
  if minute_count>=(eff->>'perMinute')::integer then return jsonb_build_object('status','agent_rate_limited','reason','minute','limit',(eff->>'perMinute')::integer); end if;
  if day_count>=(eff->>'perDay')::integer then return jsonb_build_object('status','agent_rate_limited','reason','day','limit',(eff->>'perDay')::integer); end if;
  -- Back-and-forth limit (see the header).
  if p_reply is not null then
   select coalesce(m.reply_to_id,m.id) into top from public.longboard_chat_messages m where m.id=p_reply and m.room_slug=p_room;
  end if;
  named_agent:=(p_reply is not null and exists(select 1 from public.longboard_chat_messages m
     where m.id=p_reply and m.agent_id is not null and m.agent_id<>p_agent))
   or exists(select 1 from public.chat_agents o where o.deleted_at is null and o.id<>p_agent
     and strpos(lower(p_body),'@'||lower(o.name))>0);
  select count(*),count(*) filter (where r.agent_id is not null),coalesce(bool_or(r.agent_id is not null and r.agent_id<>p_agent),false)
   into recent,agent_posts,others
   from (select m.agent_id from public.longboard_chat_messages m
    where m.room_slug=p_room and not m.removed and m.bot_slug is null
     and (case when top is null then m.reply_to_id is null else (m.id=top or m.reply_to_id=top) end)
    order by m.created_at desc limit (eff->>'maxTurns')::integer) r;
  if recent=(eff->>'maxTurns')::integer and agent_posts=recent and (named_agent or others) then
   return jsonb_build_object('status','agent_turn_limit','limit',recent);
  end if;
 end if;
 perform set_config('chat.agent_id',p_agent::text,true);
 result:=public.send_chat_room_message(ag.owner_id,p_room,p_body,p_reply,p_files,p_client);
 perform set_config('chat.agent_id','',true);
 if result->>'status' in ('sent','duplicate') then
  if (result->'message'->>'agent_id') is distinct from p_agent::text then return jsonb_build_object('status','send_conflict'); end if;
  result:=jsonb_set(result,'{message}',(result->'message')||jsonb_build_object('author_label',ag.name,'memberships','[]'::jsonb,
   'agent',jsonb_build_object('id',ag.id,'name',ag.name,'owner',owner_member.display_name)));
 end if;
 return result;
end $$;

-- Which of these messages an agent posted, with its name and its owner's current chat name.
create function public.chat_agent_message_identities(p_ids uuid[]) returns table(message_id uuid,agent_id uuid,name text,owner_name text)
language sql stable security invoker set search_path='' as $$
 select m.id,a.id,a.name,coalesce(o.display_name,'')
 from public.longboard_chat_messages m join public.chat_agents a on a.id=m.agent_id
 left join public.longboard_chat_members o on o.id=m.member_id
 where m.id=any(p_ids) and m.agent_id is not null and coalesce(cardinality(p_ids),0)<=200;
$$;

create function public.chat_agent_mutes_list(actor uuid) returns uuid[]
language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(agent_id order by created_at),'{}') from public.chat_agent_mutes where account_id=actor;
$$;

create function public.chat_agent_mute_set(actor uuid,p_agent uuid,p_muted boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_muted is null then raise exception 'invalid_mute'; end if;
 if p_muted then
  if not exists(select 1 from public.chat_agents where id=p_agent) then return false; end if;
  insert into public.chat_agent_mutes(account_id,agent_id) values(actor,p_agent) on conflict do nothing;
 else
  delete from public.chat_agent_mutes where account_id=actor and agent_id=p_agent;
 end if;
 return true;
end $$;

revoke all on function public.chat_agent_rooms(),public.chat_agent_stamp_message(),public.chat_agent_keep_message_agent(),
 public.chat_agent_owner_ok(uuid),public.chat_agent_is_admin(uuid),public.chat_agent_ceiling(),public.chat_agent_effective(uuid),
 public.chat_agent_json(public.chat_agents),public.chat_agent_list(uuid),public.chat_agent_name_free(text,uuid),
 public.chat_agent_create(uuid,text),public.chat_agent_update(uuid,uuid,jsonb),public.chat_agent_delete(uuid,uuid),
 public.chat_agent_token_create(uuid,uuid,text,text,text),public.chat_agent_token_revoke(uuid,uuid),
 public.chat_agent_ceiling_update(uuid,jsonb),public.chat_agent_admin_list(uuid),public.chat_agent_admin_pause(uuid,uuid,boolean),
 public.chat_agent_request_context(text),public.send_chat_agent_message(uuid,text,text,uuid,uuid[],uuid),
 public.chat_agent_message_identities(uuid[]),public.chat_agent_mutes_list(uuid),public.chat_agent_mute_set(uuid,uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.chat_agent_rooms(),public.chat_agent_owner_ok(uuid),public.chat_agent_is_admin(uuid),
 public.chat_agent_ceiling(),public.chat_agent_effective(uuid),public.chat_agent_json(public.chat_agents),public.chat_agent_list(uuid),
 public.chat_agent_name_free(text,uuid),public.chat_agent_create(uuid,text),public.chat_agent_update(uuid,uuid,jsonb),
 public.chat_agent_delete(uuid,uuid),public.chat_agent_token_create(uuid,uuid,text,text,text),public.chat_agent_token_revoke(uuid,uuid),
 public.chat_agent_ceiling_update(uuid,jsonb),public.chat_agent_admin_list(uuid),public.chat_agent_admin_pause(uuid,uuid,boolean),
 public.chat_agent_request_context(text),public.send_chat_agent_message(uuid,text,text,uuid,uuid[],uuid),
 public.chat_agent_message_identities(uuid[]),public.chat_agent_mutes_list(uuid),public.chat_agent_mute_set(uuid,uuid,boolean)
 to service_role;
grant select,insert,update,delete on public.chat_agent_settings,public.chat_agents,public.chat_agent_tokens,public.chat_agent_mutes to service_role;
