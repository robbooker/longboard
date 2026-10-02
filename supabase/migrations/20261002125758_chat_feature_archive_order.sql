-- Read-only dates from committed workflow evidence; publishing/archive mutations stay unchanged.
create view public.chat_feature_request_list with (security_invoker=true) as
with legacy_requests as materialized (
 select legacy.id from public.chat_feature_requests legacy
 where legacy.status='done'
  and not exists(select 1 from public.chat_feature_releases published where published.request_id=legacy.id and published.state='published')
), legacy_completion as (
 select n.request_id,min(n.created_at) completed_at
 from public.chat_feature_notifications n
 where n.category='status' and n.event_key like 'status:%' and n.label='Published and verified'
  and n.request_id=any(array(select id from legacy_requests))
 group by n.request_id
)
select r.id,r.title,r.priority,r.priority_revision,r.priority_set_at,r.proposal,r.revision,
 r.approved_proposal,r.approved_at,r.status,r.claimed_at,r.created_at,r.outcome,
 case when l.request_id is null then null else jsonb_build_object(
  'pr_number',l.pr_number,'head_sha',l.head_sha,'version',l.version,'state',l.state,
  'approved_at',l.approved_at,'outcome',l.outcome) end release,
 case when r.status='archived' then r.archived_at
  when r.status='done' and l.state='published' then l.updated_at
  when r.status='done' then legacy.completed_at
  else null end archive_order_at
from public.chat_feature_requests r
left join public.chat_feature_releases l on l.request_id=r.id
left join legacy_completion legacy on legacy.request_id=r.id;

revoke all on public.chat_feature_request_list from public,anon,authenticated,service_role;
grant select on public.chat_feature_request_list to service_role;
