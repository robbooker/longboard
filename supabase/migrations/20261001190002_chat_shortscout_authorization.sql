-- Identity, current authorization and offline recipient classification are separate.
-- Source v2 must be deployed and verified before this migration/application rollout.
create table public.chat_shortscout_authorization (
 subject uuid primary key,
 generation bigint not null default 0,
 requested_at timestamptz,
 pending boolean not null default false,
 request_context jsonb,
 decision text check(decision in ('allow','deny')),
 membership_level text check(membership_level in ('monthly','annual','lifetime','mastermind')),
 checked_at timestamptz,
 valid_until timestamptz,
 retry_after timestamptz,
 check((decision='allow' and membership_level is not null) or (decision is distinct from 'allow' and membership_level is null))
);
create table public.chat_shortscout_rollout (
 singleton boolean primary key default true check(singleton),
 migrated_at timestamptz not null,
 legacy_until timestamptz not null
);
insert into public.chat_shortscout_rollout values(true,clock_timestamp(),clock_timestamp()+interval '24 hours');
create table public.chat_shortscout_legacy_access (
 subject uuid primary key,
 membership_level text not null,
 expires_at timestamptz not null
);
-- Capture once. Neither an old callback nor a renewed verified_at moves this horizon.
insert into public.chat_shortscout_legacy_access
 select subject,membership_level,least(verified_at+interval '12 hours',r.legacy_until)
 from public.chat_provider_identities cross join public.chat_shortscout_rollout r
 where provider='shortscout' and verified_at>now()-interval '12 hours';
alter table public.chat_shortscout_authorization enable row level security;
alter table public.chat_shortscout_rollout enable row level security;
alter table public.chat_shortscout_legacy_access enable row level security;
revoke all on public.chat_shortscout_authorization,public.chat_shortscout_rollout,public.chat_shortscout_legacy_access from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_shortscout_authorization to service_role;
grant select on public.chat_shortscout_rollout,public.chat_shortscout_legacy_access to service_role;

-- This resolves an already-bound identity, not an entitlement or login proof.
create function public.chat_shortscout_binding(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(i) from (
  select p.subject,p.membership_level,p.verified_at,p.account_id source_account_id,false bridged,
    p.account_id::text binding_version
  from public.chat_provider_identities p where p.account_id=p_account and p.provider='shortscout'
  union all
  select p.subject,p.membership_level,p.verified_at,p.account_id,true,
    p.account_id::text||':'||l.updated_at::text
  from public.chat_shortscout_membership_links l
  join public.chat_provider_identities p on (p.provider,p.subject,p.account_id)=(l.provider,l.subject,l.source_account_id)
  join public.chat_accounts a on a.id=l.lb_account_id
  join public.chat_accounts source on source.id=l.source_account_id
  join public.profiles profile on profile.id=a.longboard_user_id
  where l.lb_account_id=p_account and l.revoked_at is null and source.longboard_user_id is null and a.id=a.longboard_user_id
   and not exists(select 1 from public.chat_provider_identities direct where direct.account_id=p_account and direct.provider='shortscout')
 ) i order by bridged limit 1;
$$;

-- Historical 12-hour classification is for offline candidates, never actor access.
-- A known denial remains an override even after its retry/freshness deadline.
create or replace function public.chat_shortscout_identity(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',coalesce(a.membership_level,b->>'membership_level'))
 from binding left join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where b is not null and a.decision is distinct from 'deny'
  and case when a.decision='allow' then a.checked_at else (b->>'verified_at')::timestamptz end>now()-interval '12 hours';
$$;

create function public.chat_shortscout_authorized_identity(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with binding as (select public.chat_shortscout_binding(p_account) b)
 select b||jsonb_build_object('membership_level',a.membership_level,'authorized_until',a.valid_until)
 from binding join public.chat_shortscout_authorization a on a.subject=(b->>'subject')::uuid
 where a.decision='allow' and a.valid_until>now() and a.checked_at>now()-interval '60 seconds';
$$;

-- Non-granting candidate checks retain the existing 12-hour offline window.
create function public.chat_account_room_recipient_eligible(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers') then exists(select 1 from public.profiles where id=p_account)
  or coalesce(public.chat_shortscout_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements','ss-recordings') then coalesce(public.chat_shortscout_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$$;

-- Every existing actor RPC retains this name and therefore gets the strict check.
create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 with binding as (select public.chat_shortscout_binding(p_account) b), tier as (
  select public.chat_shortscout_authorized_identity(p_account)->>'membership_level' value
  union all
  select l.membership_level from binding
  join public.chat_shortscout_legacy_access l on l.subject=(b->>'subject')::uuid
  cross join public.chat_shortscout_rollout rollout
  where now()<rollout.legacy_until and now()<l.expires_at
   and not exists(select 1 from public.chat_shortscout_authorization a where a.subject=l.subject)
 ) select case
 when p_room not in ('main','social','shortscout','lb-announcements','lb-recordings','ss-announcements','ss-recordings','gainers') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
 when p_room in ('main','lb-announcements','lb-recordings') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room in ('social','gainers') then exists(select 1 from public.profiles where id=p_account)
  or exists(select 1 from tier where value in ('monthly','annual','lifetime','mastermind'))
 when p_room in ('shortscout','ss-announcements','ss-recordings') then exists(select 1 from tier where value='mastermind')
 else false end;
$$;

create function public.chat_shortscout_principal_valid(p_account uuid,p_session_hash text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case when p_session_hash is null then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and a.id=a.longboard_user_id)
 else exists(select 1 from public.chat_sessions where token_hash=p_session_hash and account_id=p_account and revoked_at is null and expires_at>clock_timestamp()) end;
$$;

create function public.chat_shortscout_reserve_authorization(p_subject uuid,p_context jsonb,p_force boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare proof public.chat_shortscout_authorization;
begin
 insert into public.chat_shortscout_authorization(subject) values(p_subject) on conflict do nothing;
 select * into proof from public.chat_shortscout_authorization where subject=p_subject for update;
 if not p_force then
  if proof.valid_until>clock_timestamp() then return jsonb_build_object('mode','ready','decision',proof.decision,'level',proof.membership_level); end if;
  if proof.pending and proof.requested_at>clock_timestamp()-interval '6 seconds' then return jsonb_build_object('mode','pending'); end if;
  if proof.retry_after>clock_timestamp() then return jsonb_build_object('mode','unavailable'); end if;
 end if;
 update public.chat_shortscout_authorization set generation=generation+1,requested_at=clock_timestamp(),pending=true,request_context=p_context
 where subject=p_subject returning * into proof;
 return jsonb_build_object('mode','refresh','subject',p_subject,'generation',proof.generation);
end $$;

create function public.begin_chat_shortscout_renewal(p_account uuid,p_session_hash text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare binding jsonb; context jsonb; result jsonb;
begin
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return jsonb_build_object('mode','invalid'); end if;
 binding:=public.chat_shortscout_binding(p_account);
 if binding is null then return jsonb_build_object('mode','absent'); end if;
 context:=jsonb_build_object('account',p_account,'session',p_session_hash,'binding',binding->>'binding_version');
 result:=public.chat_shortscout_reserve_authorization((binding->>'subject')::uuid,context);
 -- Reserve may wait on another transaction: validate the current context again
 -- after holding the proof lock, never return a pre-wait principal/binding.
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return jsonb_build_object('mode','invalid'); end if;
 if public.chat_shortscout_binding(p_account) is distinct from binding then return jsonb_build_object('mode','invalid'); end if;
 return result||jsonb_build_object('binding',binding);
end $$;

create function public.chat_shortscout_apply_authorization(p_subject uuid,p_generation bigint,p_context jsonb,p_state text,p_level text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare proof public.chat_shortscout_authorization;
begin
 if p_state is null or p_state not in ('allow','deny','unavailable')
  or (p_state='allow' and (p_level is null or p_level not in ('monthly','annual','lifetime','mastermind')))
  or (p_state<>'allow' and p_level is not null) then raise exception 'invalid_authorization'; end if;
 select * into proof from public.chat_shortscout_authorization where subject=p_subject for update;
 if not found or not proof.pending or proof.generation<>p_generation or proof.request_context is distinct from p_context
  or proof.requested_at<=clock_timestamp()-interval '6 seconds' then return false; end if;
 update public.chat_shortscout_authorization set pending=false,
  decision=case when p_state='unavailable' then decision else p_state end,
  membership_level=case when p_state='unavailable' then membership_level else p_level end,
  checked_at=case when p_state='unavailable' then checked_at else proof.requested_at end,
  valid_until=case when p_state='unavailable' then clock_timestamp() else proof.requested_at+interval '60 seconds' end,
  retry_after=case when p_state='unavailable' then clock_timestamp()+interval '5 seconds' else null end
 where subject=p_subject;
 return true;
end $$;

create function public.finish_chat_shortscout_renewal(p_account uuid,p_session_hash text,p_subject uuid,p_generation bigint,p_state text,p_level text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare binding jsonb; context jsonb;
begin
 -- Lock first: revocation committed while waiting must be visible below.
 perform 1 from public.chat_shortscout_authorization where subject=p_subject for update;
 if not public.chat_shortscout_principal_valid(p_account,p_session_hash) then return false; end if;
 binding:=public.chat_shortscout_binding(p_account);
 if binding is null or (binding->>'subject')::uuid<>p_subject then return false; end if;
 context:=jsonb_build_object('account',p_account,'session',p_session_hash,'binding',binding->>'binding_version');
 return public.chat_shortscout_apply_authorization(p_subject,p_generation,context,p_state,p_level);
end $$;

-- Validate the original one-use handoff before requesting a fresh source proof.
create function public.begin_chat_login_authorization(p_state_hash text,p_code_hash text,p_challenge text,p_link_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.chat_login_requests;
begin
 select * into r from public.chat_login_requests where state_hash=p_state_hash for update;
 if not found or r.consumed_at is not null or r.expires_at<=now() or r.subject is null or r.code_hash is null
  or r.code_hash is distinct from p_code_hash or r.challenge is distinct from p_challenge or r.link_user_id is distinct from p_link_user_id
  or (r.expected_subject is not null and r.expected_subject<>r.subject)
  or (r.link_user_id is not null and not exists(select 1 from public.profiles where id=r.link_user_id))
 then raise exception 'invalid_login_handoff'; end if;
 return public.chat_shortscout_reserve_authorization(r.subject,jsonb_build_object('login',p_state_hash),true);
end $$;

create function public.finish_chat_login_authorization(p_state_hash text,p_code_hash text,p_challenge text,p_link_user_id uuid,p_session_hash text,p_generation bigint,p_state text,p_level text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.chat_login_requests; result jsonb;
begin
 select * into r from public.chat_login_requests where state_hash=p_state_hash for update;
 if not found or r.consumed_at is not null or r.expires_at<=now() or r.subject is null or r.code_hash is null
  or r.code_hash is distinct from p_code_hash or r.challenge is distinct from p_challenge or r.link_user_id is distinct from p_link_user_id
  or (r.expected_subject is not null and r.expected_subject<>r.subject)
  or (r.link_user_id is not null and not exists(select 1 from public.profiles where id=r.link_user_id))
 then raise exception 'invalid_login_handoff'; end if;
 if not public.chat_shortscout_apply_authorization(r.subject,p_generation,jsonb_build_object('login',p_state_hash),p_state,p_level)
 then return jsonb_build_object('error','login_expired'); end if;
 -- Return, rather than raise, so authoritative denial/unknown is committed.
 if p_state<>'allow' then return jsonb_build_object('error',case when p_state='deny' then 'insufficient_membership' else 'login_unavailable' end); end if;
 if r.return_room in ('shortscout','ss-announcements','ss-recordings') and p_level<>'mastermind'
 then return jsonb_build_object('error','insufficient_membership'); end if;
 if r.link_user_id is not null and exists(select 1 from public.chat_shortscout_membership_links
  where lb_account_id=r.link_user_id and revoked_at is not null and revoked_at>=r.created_at)
 then return jsonb_build_object('error','link_session_changed'); end if;
 update public.chat_login_requests set membership_level=p_level where state_hash=p_state_hash;
 result:=public.consume_chat_login(p_state_hash,p_code_hash,p_challenge,p_link_user_id,p_session_hash);
 -- The old signature remains a 12-hour issuer. Only this fresh handoff mints 30 days.
 update public.chat_sessions set expires_at=created_at+interval '30 days' where token_hash=p_session_hash;
 return result||jsonb_build_object('sessionMaxAge',2592000);
end $$;

revoke all on function public.chat_shortscout_binding(uuid),public.chat_shortscout_authorized_identity(uuid),public.chat_account_room_recipient_eligible(uuid,text),public.chat_shortscout_principal_valid(uuid,text),public.chat_shortscout_reserve_authorization(uuid,jsonb,boolean),public.begin_chat_shortscout_renewal(uuid,text),public.chat_shortscout_apply_authorization(uuid,bigint,jsonb,text,text),public.finish_chat_shortscout_renewal(uuid,text,uuid,bigint,text,text),public.begin_chat_login_authorization(text,text,text,uuid),public.finish_chat_login_authorization(text,text,text,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.chat_shortscout_binding(uuid),public.chat_shortscout_authorized_identity(uuid),public.chat_account_room_recipient_eligible(uuid,text),public.chat_shortscout_principal_valid(uuid,text),public.chat_shortscout_reserve_authorization(uuid,jsonb,boolean),public.begin_chat_shortscout_renewal(uuid,text),public.chat_shortscout_apply_authorization(uuid,bigint,jsonb,text,text),public.finish_chat_shortscout_renewal(uuid,text,uuid,bigint,text,text),public.begin_chat_login_authorization(text,text,text,uuid),public.finish_chat_login_authorization(text,text,text,uuid,text,bigint,text,text) to service_role;

-- A delayed pre-revocation legacy connection cannot silently reactivate the bridge.
create or replace function public.consume_chat_login(
 p_state_hash text,p_code_hash text,p_challenge text,p_link_user_id uuid,p_session_hash text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.chat_login_requests; a uuid; existing_account uuid; source_lb uuid;
 prior public.chat_shortscout_membership_links; bridge boolean:=false;
begin
 select * into r from public.chat_login_requests where state_hash=p_state_hash for update;
 if not found or r.consumed_at is not null or r.expires_at<=now() or r.code_hash is null or p_code_hash is null or p_challenge is null
  or r.code_hash<>p_code_hash or r.challenge<>p_challenge or r.link_user_id is distinct from p_link_user_id then raise exception 'invalid_login_handoff'; end if;
 if r.expected_subject is not null and r.subject is distinct from r.expected_subject then raise exception 'identity_mismatch'; end if;
 if r.return_room in ('shortscout','ss-announcements','ss-recordings') and r.membership_level is distinct from 'mastermind' then raise exception 'insufficient_membership'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-provider:shortscout:'||r.subject::text,0));
 select account_id into existing_account from public.chat_provider_identities where provider='shortscout' and subject=r.subject;
 if r.link_user_id is not null then
  if not exists(select 1 from public.profiles where id=r.link_user_id) then raise exception 'longboard_membership_required'; end if;
  insert into public.chat_accounts(id,longboard_user_id) values(r.link_user_id,r.link_user_id) on conflict(longboard_user_id) do nothing;
  select id into a from public.chat_accounts where longboard_user_id=r.link_user_id for update;
  -- Current application deliberately preserves LB account ID = LB auth ID.
  if a is distinct from r.link_user_id then raise exception 'identity_already_linked'; end if;
  if exists(select 1 from public.chat_provider_identities where account_id=a and provider='shortscout' and subject<>r.subject)
   or exists(select 1 from public.chat_shortscout_membership_links where lb_account_id=a and subject<>r.subject)
   or exists(select 1 from public.chat_shortscout_membership_links where subject=r.subject and lb_account_id<>a)
  then raise exception 'identity_already_linked'; end if;
  if existing_account is not null and existing_account<>a then
   select longboard_user_id into source_lb from public.chat_accounts where id=existing_account and longboard_user_id is null for update;
   if not found then raise exception 'identity_already_linked'; end if;
   select * into prior from public.chat_shortscout_membership_links where lb_account_id=a for update;
   if prior.revoked_at is not null and prior.revoked_at>=r.created_at then raise exception 'link_session_changed'; end if;
   insert into public.chat_shortscout_membership_links(lb_account_id,source_account_id,subject)
   values(a,existing_account,r.subject)
   on conflict(lb_account_id) do update set revoked_at=null,updated_at=now()
    where chat_shortscout_membership_links.source_account_id=excluded.source_account_id and chat_shortscout_membership_links.subject=excluded.subject;
   if prior.lb_account_id is null or prior.revoked_at is not null then
    insert into public.chat_shortscout_link_events(lb_account_id,source_account_id,subject,action,request_hash)
    values(a,existing_account,r.subject,case when prior.lb_account_id is null then 'connected' else 'reactivated' end,p_state_hash);
   end if;
   bridge:=true;
  end if;
 else
  a:=existing_account;
  if a is null then insert into public.chat_accounts default values returning id into a; end if;
 end if;
 -- Refresh the original identity; never move its ownership or historical actor.
 insert into public.chat_provider_identities(provider,subject,account_id,membership_level)
 values('shortscout',r.subject,coalesce(existing_account,a),r.membership_level)
 on conflict(provider,subject) do update set membership_level=excluded.membership_level,verified_at=now();
 insert into public.chat_sessions(token_hash,account_id,expires_at) values(p_session_hash,a,now()+interval '12 hours');
 update public.chat_login_requests set consumed_at=now() where state_hash=p_state_hash;
 return jsonb_build_object('accountId',a,'room',r.return_room,'popout',r.popout,'membershipBridge',bridge);
end $$;
