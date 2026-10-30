-- Rollback of 20261030200000_chat_bot_accounts.sql (#330). Restores the exact previous definition
-- of each function changed, then removes the bot table.
-- Without chat_bot_accounts a bot would be an ordinary member, so its tokens and API invite are
-- removed first. Its member row and past messages stay; delete them separately if wanted.

delete from public.chat_api_tokens where account_id in (select account_id from public.chat_bot_accounts);
delete from public.chat_api_access where account_id in (select account_id from public.chat_bot_accounts);

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$function$;

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$;

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
   and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=actor and b.blocked_id=m.id) or (b.blocker_id=m.id and b.blocked_id=actor));
 return total;
end $function$;

drop function public.chat_member_membership_sources(uuid[]);
create function public.chat_member_membership_sources(p_member_ids uuid[])
returns table(member_id uuid,longboard boolean,shortscout_subject uuid)
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
  )
 from public.longboard_chat_members m
 where m.id=any(p_member_ids) and coalesce(cardinality(p_member_ids),0)<=200;
$$;
revoke all on function public.chat_member_membership_sources(uuid[]) from public,anon,authenticated;
grant execute on function public.chat_member_membership_sources(uuid[]) to service_role;

create or replace function public.chat_api_request_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.chat_api_tokens; profile public.profiles;
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
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=profile.id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(profile.id,null));
end $$;

create or replace function public.chat_longboard_request_context(p_user uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles;
begin
 if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 then return jsonb_build_object('mode','unauthenticated'); end if;
 select * into profile from public.profiles where id=p_user;
 if not found then return jsonb_build_object('mode','no_profile'); end if;
 -- Concurrent first visits are safe; never overwrite an existing link.
 insert into public.chat_accounts(id,longboard_user_id) values(p_user,p_user) on conflict (id) do nothing;
 return jsonb_build_object('mode','ok',
  'user',jsonb_build_object('id',profile.id,'email',profile.email,'role',profile.role),
  'boardroom',exists(select 1 from public.user_tags where user_id=p_user and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(p_user,null));
end $$;

create or replace function public.chat_session_request_context(p_token_hash text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare account public.chat_accounts; profile public.profiles;
begin
 select a.* into account from public.chat_sessions s join public.chat_accounts a on a.id=s.account_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>clock_timestamp();
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
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

drop trigger chat_bot_refuse_conversation on public.longboard_chat_conversations;
drop trigger chat_bot_refuse_admin_role on public.profiles;
drop trigger chat_bot_refuse_admin_row on public.chat_bot_accounts;
drop function public.chat_bot_refuse_conversation();
drop function public.chat_bot_refuse_admin_role();
drop function public.chat_bot_refuse_admin_row();
drop table public.chat_bot_accounts;
