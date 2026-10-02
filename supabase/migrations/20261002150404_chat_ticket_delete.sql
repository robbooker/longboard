-- A discussion is the existing unsubmitted lifecycle; never widen it to approved work.
create function public.can_delete_chat_feature(actor uuid, feature uuid, expected_revision integer)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.chat_feature_requests r
  join public.chat_feature_members m on m.account_id=actor
  where r.id=feature and r.created_by=actor and r.revision=expected_revision
   and expected_revision>0 and r.status='discussion'
   and r.approved_by is null and r.approved_at is null and r.approved_proposal is null
   and r.claimed_at is null and r.worker_token is null
   and r.archived_at is null and r.archived_by is null and r.outcome is null
   and not exists(select 1 from public.chat_feature_releases l where l.request_id=r.id)
 );
$$;

create function public.delete_chat_feature(actor uuid, feature uuid, expected_revision integer)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 -- Same request lock as proposal editing, approval, archive and release registration.
 -- A later operation observes the deletion; an earlier operation must still qualify.
 perform 1 from public.chat_feature_requests r where r.id=feature for update;
 if not found or not public.can_delete_chat_feature(actor,feature,expected_revision) then
  raise exception 'ticket_not_deletable';
 end if;
 -- Existing FKs remove only this draft's messages, notification events and mutes.
 -- A release is forbidden above even if an inconsistent discussion row has one.
 delete from public.chat_feature_requests r where r.id=feature;
 return feature;
end;
$$;

revoke all on function public.can_delete_chat_feature(uuid,uuid,integer),public.delete_chat_feature(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.can_delete_chat_feature(uuid,uuid,integer),public.delete_chat_feature(uuid,uuid,integer) to service_role;
