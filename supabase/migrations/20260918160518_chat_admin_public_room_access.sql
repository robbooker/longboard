-- Public room admin exception; no DM or private feature authorization changes.
create or replace function public.chat_account_has_room(p_account uuid,p_room text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case
 when p_room not in ('main','social','shortscout','lb-announcements','ss-announcements') or p_room is null then false
 when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=p_account and p.role='admin') then true
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
-- Authoritative profile role grants only the five public rooms. Reactions already
-- require a visible message through their existing RLS policy.
alter policy "members read chat messages" on public.longboard_chat_messages
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
 (p.role='admin' and room_slug in ('main','social','shortscout','lb-announcements','ss-announcements')) or
 room_slug='social' or
 (room_slug='main' and exists(select 1 from public.user_tags t where t.user_id=p.id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')))
)));
