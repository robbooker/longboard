-- Fail closed for LB/Boardroom and LB announcements. SOCIAL and SS unchanged.
create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room in ('main','lb-announcements') then exists(
  select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
  join public.user_tags t on t.user_id=p.id
  where a.id=p_account and t.tag in ('boardroom-cohort-1','boardroom-cohort-2'))
 when p_room='social' then exists(select 1 from public.profiles where id=p_account)
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 when p_room in ('shortscout','ss-announcements') then exists(select 1 from public.profiles where id=p_account and role='admin')
   or exists(select 1 from public.chat_provider_identities where account_id=p_account and verified_at>now()-interval '12 hours')
 else false end;
$$;
alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 room_slug='social' or (room_slug='shortscout' and p.role='admin') or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));
-- LB announcement notification previews must follow the same cohort boundary.
create or replace function public.notify_chat_announcement() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.room_slug not in ('lb-announcements','ss-announcements') then return new; end if;
 insert into public.chat_room_mentions(account_id,message_id,room_slug)
 select a.id,new.id,new.room_slug from public.chat_accounts a
 where (new.room_slug='lb-announcements' and public.chat_account_has_room(a.id,new.room_slug))
 or (new.room_slug='ss-announcements' and (
  exists(select 1 from public.chat_provider_identities i where i.account_id=a.id and i.provider='shortscout')
  or exists(select 1 from public.profiles p where p.id=a.longboard_user_id and p.role='admin')
 )) on conflict(account_id,message_id) do nothing;
 return new;
end $$;
