-- Batch projection for already-authorized message readers only. No room/admin inference.
create function public.chat_member_memberships(p_member_ids uuid[])
returns table(member_id uuid,memberships text[]) language sql stable security invoker set search_path='' as $$
 select m.id, array_remove(array[
  case when exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
   join public.user_tags t on t.user_id=p.id where a.id=m.user_id and t.tag in ('boardroom-cohort-1','boardroom-cohort-2')) then 'LB' end,
  case when exists(select 1 from public.chat_provider_identities i where i.account_id=m.user_id and i.provider='shortscout'
   and i.membership_level in ('monthly','annual','lifetime','mastermind') and i.verified_at>now()-interval '12 hours') then 'SS' end
 ],null)::text[]
 from public.longboard_chat_members m where m.id=any(p_member_ids);
$$;
revoke all on function public.chat_member_memberships(uuid[]) from public,anon,authenticated;
grant execute on function public.chat_member_memberships(uuid[]) to service_role;
