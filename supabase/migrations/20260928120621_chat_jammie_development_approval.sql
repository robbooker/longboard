-- Development permission is separate from the owner role and release authorization.
-- Resolve only the existing trusted Jammie association used by the original feature seed.
-- Missing/changed association fails closed; future participants default to no permission.
alter table public.chat_feature_members add column can_approve_development boolean not null default false;
update public.chat_feature_members m set can_approve_development=true
from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id
where m.account_id=a.id and m.account_id='6ad10d99-fe91-4955-86fa-a893b9763573'::uuid and m.role='participant' and lower(p.email)='ojammie@gmail.com';

create or replace function public.chat_feature_action(actor uuid, request_id uuid, action text, content text default '', expected_revision integer default 0)
returns uuid language plpgsql security invoker set search_path=public as $$
declare member_role text; development_approver boolean; r public.chat_feature_requests; result uuid;
begin
 select role, can_approve_development into member_role, development_approver from chat_feature_members where account_id=actor;
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
  insert into chat_feature_messages(request_id,author_id,author_label,body) values(r.id,actor,case when member_role='owner' then 'Rob' else 'Jammie' end,content);
 elsif action='proposal' then
  if r.status<>'discussion' or r.revision<>expected_revision then raise exception 'proposal_changed_or_locked'; end if;
  update chat_feature_requests set proposal=content,revision=revision+1 where id=r.id;
 elsif action in ('approve','decline') then
  if action='decline' and member_role<>'owner' then raise exception 'owner_only'; end if;
  if action='approve' and member_role<>'owner' and not development_approver then raise exception 'development_approver_only'; end if;
  if r.status<>'discussion' or r.revision<>expected_revision then raise exception 'proposal_changed_or_locked'; end if;
  if action='approve' and length(trim(r.proposal))=0 then raise exception 'proposal_required'; end if;
  update chat_feature_requests set status=case when action='approve' then 'approved' else 'declined' end,
   approved_proposal=case when action='approve' then r.proposal end,approved_by=case when action='approve' then actor end,
   approved_at=case when action='approve' then now() end where id=r.id;
  insert into chat_feature_messages(request_id,author_id,author_label,kind,body) values(r.id,actor,case when member_role='owner' then 'Rob' else 'Jammie' end,'system',case when action='approve' then (case when member_role='owner' then 'Rob' else 'Jammie' end)||' approved this proposal for development. Only Rob can approve merging and publishing.' else 'Rob declined this request.' end);
 else raise exception 'invalid_action'; end if;
 return r.id;
end $$;
revoke all on function public.chat_feature_action(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.chat_feature_action(uuid,uuid,text,text,integer) to service_role;

-- Notify other feature members atomically; existing preference/mute rules still apply.
create or replace function public.chat_feature_request_notifications() returns trigger
language plpgsql security invoker set search_path=public as $$
declare recipient record; event text; label text;
begin
 if TG_OP='INSERT' then
  for recipient in select account_id from chat_feature_members where role='owner' and account_id<>new.created_by loop
   perform emit_chat_feature_notification(recipient.account_id,new.id,'request:'||new.id,'requests','New feature request',false);
  end loop;
 elsif new.status is distinct from old.status then
  label:=case new.status when 'approved' then 'Approved for development' when 'declined' then 'Request declined' when 'in_progress' then 'Development started' when 'blocked' then 'Needs your decision' when 'ready' then 'Ready to test' when 'done' then 'Published and verified' end;
  if label is null then return new; end if;
  event:='status:'||gen_random_uuid();
  for recipient in select account_id,role from chat_feature_members loop
   if (new.status='approved' and recipient.account_id=new.approved_by) or (new.status='declined' and recipient.role<>'participant') or (new.status='blocked' and recipient.role<>'owner') then continue; end if;
   perform emit_chat_feature_notification(recipient.account_id,new.id,event,'status',label,new.status in ('blocked','ready'));
  end loop;
 end if;
 return new;
end $$;
