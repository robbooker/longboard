-- Allow explicitly invited additional participants; retain the single-owner constraint.
drop index if exists public.chat_feature_one_participant;

-- Attribute participant messages to the signed-in member rather than a fixed name.
create or replace function public.chat_feature_action(actor uuid, request_id uuid, action text, content text default '', expected_revision integer default 0)
returns uuid language plpgsql security invoker set search_path=public as $$
declare member_role text; r public.chat_feature_requests; result uuid;
begin
 select role into member_role from chat_feature_members where account_id=actor;
 if member_role is null then raise exception 'feature_access_denied'; end if;
 perform pg_advisory_xact_lock(hashtext(actor::text));
 if action='create' then
  if (select count(*) from chat_feature_requests where created_by=actor and created_at>now()-interval '1 hour')>=20 then raise exception 'rate_limited'; end if;
  insert into chat_feature_requests(title,created_by) values(content,actor) returning id into result; return result;
 end if;
 select * into r from chat_feature_requests where id=request_id for update;
 if r.id is null then raise exception 'request_not_found'; end if;
 if action='message' then
  if (select count(*) from chat_feature_messages where author_id=actor and created_at>now()-interval '1 hour')>=60 then raise exception 'rate_limited'; end if;
  insert into chat_feature_messages(request_id,author_id,author_label,body) values(r.id,actor,case when member_role='owner' then 'Rob' else coalesce((select display_name from public.longboard_chat_members where user_id=actor),'Member') end,content);
 elsif action='proposal' then
  if r.status<>'discussion' or r.revision<>expected_revision then raise exception 'proposal_changed_or_locked'; end if;
  update chat_feature_requests set proposal=content,revision=revision+1 where id=r.id;
 elsif action in ('approve','decline') then
  if member_role<>'owner' then raise exception 'owner_only'; end if;
  if r.status<>'discussion' or r.revision<>expected_revision then raise exception 'proposal_changed_or_locked'; end if;
  if action='approve' and length(trim(r.proposal))=0 then raise exception 'proposal_required'; end if;
  update chat_feature_requests set status=case when action='approve' then 'approved' else 'declined' end,
   approved_proposal=case when action='approve' then r.proposal end,approved_by=case when action='approve' then actor end,
   approved_at=case when action='approve' then now() end where id=r.id;
  insert into chat_feature_messages(request_id,author_label,kind,body) values(r.id,'System','system',case when action='approve' then 'Rob approved this proposal for development. Publishing requires a separate approval.' else 'Rob declined this request.' end);
 else raise exception 'invalid_action'; end if;
 return r.id;
end $$;
revoke all on function public.chat_feature_action(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.chat_feature_action(uuid,uuid,text,text,integer) to service_role;
