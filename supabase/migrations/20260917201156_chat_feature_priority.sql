-- Priority is queue metadata, independent of proposal/release approval revisions.
alter table public.chat_feature_requests
 add column priority smallint not null default 2 check(priority between 0 and 3),
 add column priority_revision integer not null default 1,
 add column priority_set_at timestamptz not null default now();
create index chat_feature_priority_queue on public.chat_feature_requests(priority,priority_set_at desc,created_at,id)
 where status='approved' and approved_by is not null;

create function public.create_chat_feature(actor uuid, title text, priority integer default 2)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid;
begin
 if priority is null or priority not between 0 and 3 then raise exception 'invalid_priority'; end if;
 if priority<>2 and not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 result:=public.chat_feature_action(actor,null,'create',title,0);
 update chat_feature_requests set priority=create_chat_feature.priority where id=result;
 return result;
end $$;
create function public.set_chat_feature_priority(actor uuid, feature uuid, priority integer, expected_revision integer)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.chat_feature_requests;
begin
 if not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 if priority is null or priority not between 0 and 3 then raise exception 'invalid_priority'; end if;
 select * into r from chat_feature_requests where id=feature for update;
 if not found or r.status in ('done','archived','declined') then raise exception 'ticket_closed'; end if;
 if r.priority_revision is distinct from expected_revision then raise exception 'priority_changed'; end if;
 if r.priority=priority then return feature; end if;
 update chat_feature_requests set priority=set_chat_feature_priority.priority,priority_revision=priority_revision+1,priority_set_at=clock_timestamp() where id=feature;
 insert into chat_feature_messages(request_id,author_id,author_label,kind,body)
 values(feature,actor,'System','system','Rob changed priority to '||case when priority=0 then 'EMERGENCY' else priority::text end||'. Development and publishing approvals are unchanged.');
 return feature;
end $$;
-- Highest priority first; newly assigned tickets lead their priority tier.
-- Claimed work is never preempted: the desktop must finish publication first.
create or replace function public.claim_chat_feature(worker uuid) returns setof public.chat_feature_requests
language sql security invoker set search_path=public as $$
 update chat_feature_requests set status='in_progress',claimed_at=now(),worker_token=worker
 where id=(select id from chat_feature_requests where status='approved' and approved_by is not null
 order by priority,priority_set_at desc,created_at,id for update skip locked limit 1) returning *;
$$;
revoke all on function public.create_chat_feature(uuid,text,integer),public.set_chat_feature_priority(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.create_chat_feature(uuid,text,integer),public.set_chat_feature_priority(uuid,uuid,integer,integer) to service_role;
