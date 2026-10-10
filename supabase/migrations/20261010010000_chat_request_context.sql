-- P3: one database call answers who is asking on every chat request. Before this, a
-- Longboard request waited on the Auth server (getUser), then the profile, then the
-- account and tags, then the ShortScout copy; a chat sign-in session waited on three
-- reads in turn. The app now verifies the Longboard token locally (asymmetric signing
-- keys) and this call confirms its session still exists, so signing out, a deleted
-- user or a ban ends chat access exactly as getUser did.

-- Longboard sign-in. Security definer only to read auth.sessions and auth.users.
create function public.chat_longboard_request_context(p_user uuid,p_session uuid) returns jsonb
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

-- Chat sign-in session (ShortScout members without a Longboard login, or before linking).
create function public.chat_session_request_context(p_token_hash text) returns jsonb
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

revoke all on function public.chat_longboard_request_context(uuid,uuid),public.chat_session_request_context(text) from public,anon,authenticated;
grant execute on function public.chat_longboard_request_context(uuid,uuid),public.chat_session_request_context(text) to service_role;
