-- Rollback for 20261111170000_chat_merge_linked_profiles.sql (#444).
-- Undo every merge first (select public.chat_unmerge_linked_profile(id) from public.chat_profile_merges
-- where undone_at is null order by id desc; one per call): this file refuses while any is active,
-- because dropping the log would make them permanent. Then it removes the merge functions, tables,
-- the sign-in guard and the two new columns, and puts back consume_chat_login (from
-- 20261001190002_chat_shortscout_authorization.sql), chat_session_request_context (from
-- 20261109100000_members_stripe.sql) and the tag functions (from 20261111120000_chat_tags_follow_person.sql)
-- exactly as they were. ShortScout sign-ins moved to a Longboard account by a merge were moved back by
-- the undo; a sign-in made after the migration on a Longboard account keeps working (as Longboard).
set lock_timeout = '5s';
do $$ begin
 if exists(select 1 from public.chat_profile_merges where undone_at is null) then
  raise exception 'chat_profile_merges has active merges: undo them first (chat_unmerge_linked_profile)';
 end if;
end $$;
drop trigger if exists chat_member_link_guard on public.longboard_chat_members;
drop function if exists public.chat_member_link_guard();
drop function if exists public.chat_merge_next_linked_profile();
drop function if exists public.chat_merge_linked_profile(uuid);
drop function if exists public.chat_unmerge_linked_profile(bigint);
drop function if exists public.chat_merge_account_columns();
drop function if exists public.chat_merge_member_columns();
drop function if exists public.chat_merge_move(bigint,regclass,text,uuid,uuid);
drop function if exists public.chat_merge_delete(bigint,regclass,text);
drop function if exists public.chat_merge_set(bigint,regclass,text,jsonb,text);
drop function if exists public.chat_merge_key_columns(regclass);
drop table if exists public.chat_profile_merge_log;
drop table if exists public.chat_profile_merges;

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
 -- A genuinely new, validated legacy login gets one bounded transition horizon.
 -- All old identity horizons (including expired ones) were captured at migration;
 -- neither callbacks nor deletion/recreation can extend or recreate those grants.
 if existing_account is null and not exists(select 1 from public.chat_shortscout_authorization where subject=r.subject) then
  insert into public.chat_shortscout_legacy_access(subject,membership_level,expires_at)
  select r.subject,r.membership_level,least(clock_timestamp()+interval '12 hours',legacy_until)
  from public.chat_shortscout_rollout where clock_timestamp()<legacy_until
  on conflict(subject) do nothing;
 end if;
 insert into public.chat_sessions(token_hash,account_id,expires_at) values(p_session_hash,a,now()+interval '12 hours');
 update public.chat_login_requests set consumed_at=now() where state_hash=p_state_hash;
 return jsonb_build_object('accountId',a,'room',r.return_room,'popout',r.popout,'membershipBridge',bridge);
end $$;

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
  'shortscout',public.begin_chat_shortscout_renewal(account.id,p_token_hash),
  'member',to_jsonb(public.member_account_entitlements(account.id)));
end $function$;

create or replace function public.chat_message_tag_scan(p_body text,p_message uuid,p_history boolean)
returns table(tag_key text,tagged_as text,member_id uuid,ambiguous boolean)
language plpgsql stable security invoker set search_path='' as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; best record; seen text[]:='{}'; typed text;
begin
 if p_body is null then return; end if;
 loop
  relative_pos:=strpos(substr(p_body,scan_from),'@'); exit when relative_pos=0;
  at_pos:=scan_from+relative_pos-1; scan_from:=at_pos+1;
  if at_pos>1 and substr(p_body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
  best:=null;
  select c.len,c.member_id,c.prio,c.shared into best from (
   select length(t.tagged_as) len,t.member_id,0 prio,false shared from public.chat_message_tags t
    where not p_history and t.message_id=p_message
     and lower(substr(p_body,at_pos+1,length(t.tagged_as)))=t.tag_key
     and substr(p_body,at_pos+1+length(t.tagged_as),1) !~ '[[:alnum:]_]'
   union all
   select length(m.display_name),m.id,1,false from public.longboard_chat_members m
    where not p_history
     and lower(substr(p_body,at_pos+1,length(m.display_name)))=lower(m.display_name)
     and substr(p_body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   union all
   select length(n.display_name),n.member_id,
    case when exists(select 1 from public.chat_room_mentions r join public.longboard_chat_members mm on mm.user_id=r.account_id
     where r.message_id=p_message and r.category='mention' and mm.id=n.member_id) then -1 else 2 end,
    exists(select 1 from public.chat_member_names o where o.name_key=n.name_key and o.member_id<>n.member_id)
    from public.chat_member_names n
    where p_history
     and lower(substr(p_body,at_pos+1,length(n.display_name)))=n.name_key
     and substr(p_body,at_pos+1+length(n.display_name),1) !~ '[[:alnum:]_]'
  ) c order by c.len desc,c.prio,c.member_id limit 1;
  if best.len is null then continue; end if;
  typed:=substr(p_body,at_pos+1,best.len);
  if lower(typed)=any(seen) then continue; end if;
  seen:=seen||lower(typed);
  tag_key:=lower(typed); tagged_as:=typed;
  if best.prio=2 and best.shared then member_id:=null; ambiguous:=true; else member_id:=best.member_id; ambiguous:=false; end if;
  return next;
 end loop;
end $$;

create or replace function public.chat_tag_lookup(p_actor uuid,p_rooms text[],p_names text[],p_messages uuid[])
returns table(message_id uuid,tag_key text,member_id uuid,display_name text,avatar_path text)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_names),0)>60 or coalesce(cardinality(p_messages),0)>60 then raise exception 'invalid_query'; end if;
 return query
 select null::uuid,lower(m.display_name),m.id,m.display_name,m.avatar_path from public.longboard_chat_members m
  where lower(m.display_name)=any(coalesce(p_names,'{}'))
 union all
 select t.message_id,t.tag_key,m.id,m.display_name,m.avatar_path
  from public.chat_message_tags t
  join public.longboard_chat_messages msg on msg.id=t.message_id
  join public.longboard_chat_members m on m.id=t.member_id
  where t.message_id=any(coalesce(p_messages,'{}')) and msg.room_slug=any(coalesce(p_rooms,'{}'))
   and msg.deleted_at is null and not msg.removed and public.chat_account_has_room(p_actor,msg.room_slug);
end $$;

create or replace function public.chat_tag_suggestions(p_query text,p_hidden uuid[],p_limit integer default 10)
returns table(id uuid,display_name text,avatar_path text,previous_name text)
language plpgsql stable security invoker set search_path='' as $$
declare q text;
begin
 if p_query is null or char_length(p_query)>28 or p_limit not between 1 and 20 then raise exception 'invalid_query'; end if;
 q:=replace(replace(replace(lower(p_query),'\','\\'),'_','\_'),'%','\%')||'%';
 return query
 select s.id,s.display_name,s.avatar_path,s.previous_name from (
  select distinct on (m.id) m.id,m.display_name,m.avatar_path,
   case when lower(m.display_name) like q escape '\' then null else n.display_name end previous_name,
   lower(m.display_name) like q escape '\' current_match
  from public.longboard_chat_members m
  left join public.chat_member_names n on n.member_id=m.id and n.name_key like q escape '\' and n.name_key<>lower(m.display_name)
   and not exists(select 1 from public.chat_member_names o where o.name_key=n.name_key and o.member_id<>m.id)
   and not exists(select 1 from public.longboard_chat_members cur where lower(cur.display_name)=n.name_key and cur.id<>m.id)
  where (lower(m.display_name) like q escape '\' or n.member_id is not null)
   and not (m.user_id=any(coalesce(p_hidden,'{}')))
  order by m.id,n.display_name
 ) s order by s.current_match desc,s.display_name,s.id limit p_limit;
end $$;

alter table public.chat_sessions drop column if exists shortscout_only;
alter table public.longboard_chat_members drop column if exists merged_into, drop column if exists merged_at;
