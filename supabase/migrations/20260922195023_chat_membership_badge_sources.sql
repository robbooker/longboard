-- Display-only source mapping. Tier and login freshness are deliberately not entitlements here.
-- Existing authorization resolvers, identity ownership and badge RPC remain untouched.
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
