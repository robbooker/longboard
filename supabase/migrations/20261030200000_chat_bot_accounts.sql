-- #330 (LB-WREN) A bot account for Rob's AI assistant, limited to the Developers room.
--
-- A personal API token acts as its owner, with all their rooms and DMs. So Wren gets its own chat
-- account, marked by a row in chat_bot_accounts. That row is what restricts it:
--  * chat_account_has_room / chat_account_room_recipient_eligible: a bot has only its listed rooms,
--    checked before the admin rule. Everything built on them follows (DM directory, room mentions,
--    the bell, member lists).
--  * chat_api_request_context: a bot token returns botRooms, role 'user', no Boardroom, no ShortScout.
--    The app turns that into access limited to those rooms (lib/chatAccess.ts).
--  * chat_longboard_request_context / chat_session_request_context: a bot can't use a browser sign-in.
--  * Trigger on longboard_chat_conversations: no DM can be opened to or from a bot.
--  * Trigger on profiles, and on chat_bot_accounts: a bot can't hold the admin role.
--  * longboard_chat_room_member_count: bots aren't counted as members.
--  * chat_member_membership_sources: adds a bot column, for the "bot" badge. It has to be dropped
--    and recreated because its return columns change.
--
-- No row, no change: this migration adds no bot, and every existing account behaves exactly as before.
-- The account is created later by scripts/chat-bots/create-wren.mjs (not run by this migration).
--
-- Existing functions changed (exact previous bodies are in the rollback):
--   chat_account_has_room, chat_account_room_recipient_eligible, longboard_chat_room_member_count,
--   chat_member_membership_sources, chat_api_request_context, chat_longboard_request_context,
--   chat_session_request_context.
-- Rollback: supabase/rollbacks/20261030200000_chat_bot_accounts.down.sql

create table public.chat_bot_accounts(
 account_id uuid primary key references public.chat_accounts(id) on delete cascade,
 allowed_rooms text[] not null check (cardinality(allowed_rooms) between 1 and 10),
 created_at timestamptz not null default now()
);
alter table public.chat_bot_accounts enable row level security;
revoke all on public.chat_bot_accounts from public,anon,authenticated;
grant select,insert,update,delete on public.chat_bot_accounts to service_role;

-- A bot can't be an admin, whichever side changes first.
create function public.chat_bot_refuse_admin_row() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.profiles p where p.id=new.account_id and p.role='admin') then raise exception 'bot_cannot_be_admin'; end if;
 return new;
end $$;
create trigger chat_bot_refuse_admin_row before insert or update of account_id on public.chat_bot_accounts
 for each row execute function public.chat_bot_refuse_admin_row();

create function public.chat_bot_refuse_admin_role() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=new.id) then raise exception 'bot_cannot_be_admin'; end if;
 return new;
end $$;
create trigger chat_bot_refuse_admin_role before insert or update of role on public.profiles
 for each row when (new.role='admin') execute function public.chat_bot_refuse_admin_role();

-- No DM with a bot, whichever way round and whichever code path. Raises the error the DM routes
-- already turn into "This member is not accepting message requests."
create function public.chat_bot_refuse_conversation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.longboard_chat_members m join public.chat_bot_accounts b on b.account_id=m.user_id
   where m.id in (new.requester_id,new.recipient_id)) then raise exception 'requests_unavailable'; end if;
 return new;
end $$;
create trigger chat_bot_refuse_conversation before insert or update of requester_id,recipient_id on public.longboard_chat_conversations
 for each row execute function public.chat_bot_refuse_conversation();

revoke all on function public.chat_bot_refuse_admin_row(),public.chat_bot_refuse_admin_role(),public.chat_bot_refuse_conversation() from public,anon,authenticated;

-- Current definition with the bot rule added.

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers') or p_room is null then false
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$function$;

-- Current definition with the bot rule added.

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers') or p_room is null then false
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

-- Current definition; bots are left out of the count.

CREATE OR REPLACE FUNCTION public.longboard_chat_room_member_count(p_user_id uuid, p_room text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor uuid; total bigint;
begin
 if p_room is null or p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers') then raise exception 'invalid_room'; end if;
 if not public.chat_account_has_room(p_user_id,p_room) then raise exception 'room_access_required'; end if;
 select m.id into actor from public.longboard_chat_members m where m.user_id=p_user_id;
 if actor is null then raise exception 'member_required'; end if;
 select count(*) into total from public.longboard_chat_members m
 where public.chat_account_room_recipient_eligible(m.user_id,p_room)
   and not exists(select 1 from public.chat_bot_accounts bot where bot.account_id=m.user_id)
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

-- Same columns plus bot, for the badge.

drop function public.chat_member_membership_sources(uuid[]);
create function public.chat_member_membership_sources(p_member_ids uuid[])
returns table(member_id uuid,longboard boolean,shortscout_subject uuid,bot boolean)
language sql stable security invoker set search_path='' as $$
 select m.id,
  exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
   join public.user_tags t on t.user_id=p.id
   where a.id=m.user_id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  coalesce(
   (select i.subject from public.chat_provider_identities i where i.provider='shortscout' and i.account_id=m.user_id),
   (select i.subject from public.chat_shortscout_membership_links l
    join public.chat_provider_identities i on (i.provider,i.subject,i.account_id)=(l.provider,l.subject,l.source_account_id)
    join public.chat_accounts a on a.id=l.lb_account_id
    join public.chat_accounts source on source.id=l.source_account_id
    join public.profiles p on p.id=a.longboard_user_id
    where l.lb_account_id=m.user_id and l.revoked_at is null and source.longboard_user_id is null and a.id=a.longboard_user_id)
  ),
  exists(select 1 from public.chat_bot_accounts b where b.account_id=m.user_id)
 from public.longboard_chat_members m
 where m.id=any(p_member_ids) and coalesce(cardinality(p_member_ids),0)<=200;
$$;
revoke all on function public.chat_member_membership_sources(uuid[]) from public,anon,authenticated;
grant execute on function public.chat_member_membership_sources(uuid[]) to service_role;

-- Current definition with the bot branch added.

create or replace function public.chat_api_request_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.chat_api_tokens; profile public.profiles; bot_rooms text[];
begin
 select k.* into t from public.chat_api_tokens k
  join public.chat_api_access g on g.account_id=k.account_id
  join public.chat_accounts a on a.id=k.account_id and a.longboard_user_id=a.id
  where k.token_hash=p_token_hash and k.revoked_at is null;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 if not exists(select 1 from auth.users u where u.id=t.account_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=t.account_id;
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 update public.chat_api_tokens set last_used_at=now() where id=t.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 -- #330: a bot account gets its room list and nothing else: never admin, Boardroom or ShortScout.
 select b.allowed_rooms into bot_rooms from public.chat_bot_accounts b where b.account_id=t.account_id;
 if found then
  return jsonb_build_object('mode','ok',
   'user',jsonb_build_object('id',profile.id,'email',profile.email,'role','user'),
   'boardroom',false,'shortscout',jsonb_build_object('mode','absent'),'botRooms',to_jsonb(bot_rooms));
 end if;
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=profile.id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(profile.id,null));
end $$;

-- Current definition; a bot can't sign in through a browser.

create or replace function public.chat_longboard_request_context(p_user uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles;
begin
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 -- #330: a bot account only ever works through its API token.
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=p_user) then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=p_user;
 if not found then return jsonb_build_object('mode','no_profile'); end if;
 -- Concurrent first visits are safe; never overwrite an existing link.
 insert into public.chat_accounts(id,longboard_user_id) values(p_user,p_user) on conflict (id) do nothing;
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=p_user and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(p_user,null));
end $$;

-- Current definition; a bot can't use a chat sign-in session.

create or replace function public.chat_session_request_context(p_token_hash text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare account public.chat_accounts; profile public.profiles;
begin
 select a.* into account from public.chat_sessions s join public.chat_accounts a on a.id=s.account_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>clock_timestamp();
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 -- #330: a bot account only ever works through its API token.
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=account.id) then return jsonb_build_object('mode','unauthenticated'); end if;
 if account.longboard_user_id is not null then
  select * into profile from public.profiles where id=account.longboard_user_id;
 end if;
 return jsonb_build_object('mode','ok','account',account.id,
  'longboard',profile.id is not null,
  'role',profile.role,
  'boardroom',profile.id is not null and exists(select 1 from public.user_tags
    where user_id=account.longboard_user_id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(account.id,p_token_hash));
end $$;
