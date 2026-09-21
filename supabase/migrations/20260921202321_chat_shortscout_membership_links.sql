alter table public.chat_login_requests add column expected_subject uuid;

-- Membership association only: no identity, member, message or inbox reparenting.
alter table public.chat_provider_identities add constraint chat_provider_identity_account_key unique(provider,subject,account_id);
create table public.chat_shortscout_membership_links (
 lb_account_id uuid primary key references public.chat_accounts(id) on delete restrict,
 source_account_id uuid not null unique references public.chat_accounts(id) on delete restrict,
 provider text not null default 'shortscout' check(provider='shortscout'),
 subject uuid not null unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revoked_at timestamptz,
 check(lb_account_id<>source_account_id),
 foreign key(provider,subject,source_account_id) references public.chat_provider_identities(provider,subject,account_id) on delete cascade
);
create table public.chat_shortscout_link_events (
 id bigint generated always as identity primary key,
 lb_account_id uuid not null, source_account_id uuid not null, subject uuid not null,
 action text not null check(action in ('connected','reactivated','revoked')),
 request_hash text, created_at timestamptz not null default now()
);
alter table public.chat_shortscout_membership_links enable row level security;
alter table public.chat_shortscout_link_events enable row level security;
revoke all on public.chat_shortscout_membership_links,public.chat_shortscout_link_events from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_shortscout_membership_links to service_role;
grant select,insert on public.chat_shortscout_link_events to service_role;
grant usage,select on sequence public.chat_shortscout_link_events_id_seq to service_role;

-- Single authoritative tier/freshness source, never a copied entitlement.
create function public.chat_shortscout_identity(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(i) from (
  select p.subject,p.membership_level,p.verified_at,p.account_id as source_account_id,false as bridged
  from public.chat_provider_identities p where p.account_id=p_account and p.provider='shortscout'
  union all
  select p.subject,p.membership_level,p.verified_at,p.account_id,true
  from public.chat_shortscout_membership_links l
  join public.chat_provider_identities p on (p.provider,p.subject,p.account_id)=(l.provider,l.subject,l.source_account_id)
  join public.chat_accounts a on a.id=l.lb_account_id
  join public.chat_accounts source on source.id=l.source_account_id
  join public.profiles profile on profile.id=a.longboard_user_id
  where l.lb_account_id=p_account and l.revoked_at is null and source.longboard_user_id is null and a.id=a.longboard_user_id
   and not exists(select 1 from public.chat_provider_identities direct where direct.account_id=p_account and direct.provider='shortscout')
 ) i where i.verified_at>now()-interval '12 hours' order by bridged limit 1;
$$;
revoke all on function public.chat_shortscout_identity(uuid) from public,anon,authenticated;
grant execute on function public.chat_shortscout_identity(uuid) to service_role;

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
 if r.return_room in ('shortscout','ss-announcements') and r.membership_level is distinct from 'mastermind' then raise exception 'insufficient_membership'; end if;
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
revoke all on function public.consume_chat_login(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_chat_login(text,text,text,uuid,text) to service_role;

create function public.revoke_chat_shortscout_membership_link(p_lb_user uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare l public.chat_shortscout_membership_links;
begin
 perform 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_lb_user and a.longboard_user_id=p_lb_user for update of a;
 if not found then raise exception 'longboard_membership_required'; end if;
 update public.chat_shortscout_membership_links set revoked_at=now(),updated_at=now() where lb_account_id=p_lb_user and revoked_at is null returning * into l;
 if l.lb_account_id is null then return false; end if;
 insert into public.chat_shortscout_link_events(lb_account_id,source_account_id,subject,action) values(l.lb_account_id,l.source_account_id,l.subject,'revoked');
 return true;
end $$;
revoke all on function public.revoke_chat_shortscout_membership_link(uuid) from public,anon,authenticated;
grant execute on function public.revoke_chat_shortscout_membership_link(uuid) to service_role;

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
   or coalesce(public.chat_shortscout_identity(p_account)->>'membership_level','') in ('monthly','annual','lifetime','mastermind')
 when p_room in ('shortscout','ss-announcements') then coalesce(public.chat_shortscout_identity(p_account)->>'membership_level','')='mastermind'
 else false end;
$$;
revoke all on function public.chat_account_has_room(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_account_has_room(uuid,text) to service_role;

-- Batch projection for already-authorized message readers only. No room/admin inference.
create or replace function public.chat_member_memberships(p_member_ids uuid[])
returns table(member_id uuid,memberships text[]) language sql stable security invoker set search_path='' as $$
 select m.id, array_remove(array[
  case when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
   join public.user_tags t on t.user_id=p.id where a.id=m.user_id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')) then 'LB' end,
  case when coalesce(public.chat_shortscout_identity(m.user_id)->>'membership_level','') in ('monthly','annual','lifetime','mastermind') then 'SS' end
 ],null)::text[]
 from public.longboard_chat_members m where m.id=any(p_member_ids);
$$;
revoke all on function public.chat_member_memberships(uuid[]) from public,anon,authenticated;
grant execute on function public.chat_member_memberships(uuid[]) to service_role;

-- Existing notify_chat_announcement resolves recipients through chat_account_has_room;
-- bridged members therefore inherit only their currently authorized room alerts.
