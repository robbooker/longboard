-- Chat-only tier enforcement. Existing paid identities/sessions retain SOCIAL.
-- Admin status alone no longer grants SS history or SS announcements.
create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room in ('main','lb-announcements') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
  join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room='social' then exists(select 1 from public.profiles where id=p_account)
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and provider='shortscout' and membership_level in ('monthly','annual','lifetime','mastermind') and verified_at>now()-interval '12 hours')
 when p_room in ('shortscout','ss-announcements') then exists(select 1 from public.chat_provider_identities where account_id=p_account and provider='shortscout' and membership_level='mastermind' and verified_at>now()-interval '12 hours')
 else false end;
$$;
revoke all on function public.chat_account_has_room(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_account_has_room(uuid,text) to service_role;
-- SS history is served by authenticated APIs with fresh tier checks, including for admins.
alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 room_slug='social' or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));
-- Reactions must not reveal activity in a room whose messages are inaccessible.
alter policy "members read chat reactions" on public.longboard_chat_reactions
using (exists(select 1 from public.longboard_chat_messages m where m.id=message_id));
create or replace function public.consume_chat_login(
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
 if r.return_room in ('shortscout','ss-announcements') and r.membership_level is distinct from 'mastermind' then raise exception 'insufficient_membership'; end if;
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

-- Store announcement notifications only for accounts currently eligible to read them.
create or replace function public.notify_chat_announcement() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.room_slug not in ('lb-announcements','ss-announcements') then return new; end if;
 insert into public.chat_room_mentions(account_id,message_id,room_slug)
 select a.id,new.id,new.room_slug from public.chat_accounts a
 where public.chat_account_has_room(a.id,new.room_slug)
 on conflict(account_id,message_id) do nothing;
 return new;
end $$;
