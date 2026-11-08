-- Rollback of 20261109100000_members_stripe.sql (#384). Restores the exact previous definition of
-- each function changed (dumped with pg_get_functiondef from the migration chain before #384),
-- then removes the members tables. Every purchase, entitlement and Stripe event record is lost, so
-- export member_people / member_purchases / member_entitlements first if they matter. Club-only
-- chat accounts stay (and their sign-in sessions) but no longer reach any room.

CREATE OR REPLACE FUNCTION public.chat_account_has_room(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
begin
 return (
with tier as (select public.chat_shortscout_identity(p_account)->>'membership_level' value) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end
 );
end
$function$
;

CREATE OR REPLACE FUNCTION public.chat_account_room_recipient_eligible(p_account uuid, p_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers','whats-new','developers','lb-review','admins') or p_room is null then false
 -- #332: only admins, and never a bot, whatever its list says. Checked before every other rule.
 when p_room='admins' then not exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) and exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin')
 -- #330: a bot account has only its listed rooms. Checked before the admin rule, so nothing overrides it.
 when exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account) then exists(select 1 from public.chat_bot_accounts b where b.account_id=p_account and p_room=any(b.allowed_rooms))
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers','whats-new','developers','lb-review') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_recipient_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_api_request_context(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_longboard_request_context(p_user uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.chat_session_request_context(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.longboard_chat_link_member(p_user_id uuid, p_name text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

drop function if exists public.member_open_chat_session(text,text,timestamptz);
drop function if exists public.member_email_entitlements(text);
drop function if exists public.member_account_has_entitlement(uuid,text);
drop function if exists public.member_account_entitlements(uuid);
drop table if exists public.member_login_codes;
drop table if exists public.member_stripe_events;
drop table if exists public.member_entitlements;
drop table if exists public.member_purchases;
drop table if exists public.member_people;
drop table if exists public.member_product_stripe_ids;
drop table if exists public.member_product_entitlements;
drop table if exists public.member_products;
