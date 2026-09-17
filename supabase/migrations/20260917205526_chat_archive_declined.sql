-- Declined tickets may be filed away only when no worker or release owns them.
create or replace function public.archive_chat_feature(actor uuid, feature uuid, expected_revision integer)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.chat_feature_requests;
begin
 if not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then
  raise exception 'owner_only';
 end if;
 -- Shares the row lock used by claim_chat_feature. Whichever wins decides:
 -- archive first => no longer eligible; claim first => cancellation is rejected.
 select * into r from chat_feature_requests where id=feature for update;
 if not found then raise exception 'request_not_found'; end if;
 if r.status='archived' then return r.id; end if;
 if r.status not in ('discussion','approved','declined') or r.claimed_at is not null or r.worker_token is not null
    or exists(select 1 from chat_feature_releases where request_id=feature) then
  raise exception 'ticket_already_picked_up';
 end if;
 if r.revision is distinct from expected_revision then raise exception 'proposal_changed'; end if;
 update chat_feature_requests set status='archived',archived_at=now(),archived_by=actor where id=feature;
 -- Old alerts should not keep pointing at a cancelled item as unread work.
 update chat_feature_notifications set read_at=now() where request_id=feature and read_at is null;
 insert into chat_feature_messages(request_id,author_id,author_label,kind,body)
 values(feature,actor,'System','system','Rob archived this ticket before pickup. It is no longer queued for development.');
 return feature;
end $$;
revoke all on function public.archive_chat_feature(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.archive_chat_feature(uuid,uuid,integer) to service_role;
