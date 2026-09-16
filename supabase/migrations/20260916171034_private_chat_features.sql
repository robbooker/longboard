-- Private, server-mediated channel. No ordinary admin or member gets access.
create table public.chat_feature_members (
 account_id uuid primary key references public.chat_accounts(id),
 role text not null check(role in ('owner','participant'))
);
create unique index chat_feature_one_participant on public.chat_feature_members(role) where role='participant';
create unique index chat_feature_one_owner on public.chat_feature_members(role) where role='owner';
insert into public.chat_feature_members select a.id,'owner' from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where lower(p.email)='madspreadsheets@gmail.com';
insert into public.chat_feature_members select a.id,'participant' from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where lower(p.email)='ojammie@gmail.com';
create table public.chat_feature_requests (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 200),
 proposal text not null default '' check(length(proposal)<=12000), revision integer not null default 1,
 approved_proposal text, approved_by uuid references public.chat_accounts(id), approved_at timestamptz,
 status text not null default 'discussion' check(status in ('discussion','approved','in_progress','ready','declined','blocked')),
 created_by uuid not null references public.chat_accounts(id), created_at timestamptz not null default now(),
 claimed_at timestamptz, worker_token uuid, outcome text
);
create table public.chat_feature_messages (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.chat_feature_requests(id) on delete cascade,
 author_id uuid references public.chat_accounts(id), author_label text not null,
 kind text not null default 'human' check(kind in ('human','assistant','system')),
 body text not null check(length(body) between 1 and 16000), created_at timestamptz not null default now()
);
create index chat_feature_thread on public.chat_feature_messages(request_id,created_at);
alter table public.chat_feature_members enable row level security;
alter table public.chat_feature_requests enable row level security;
alter table public.chat_feature_messages enable row level security;
revoke all on public.chat_feature_members,public.chat_feature_requests,public.chat_feature_messages from public,anon,authenticated;
grant all on public.chat_feature_members,public.chat_feature_requests,public.chat_feature_messages to service_role;
-- Serialize edits and approvals. Client cannot supply its role or approve a stale proposal.
create function public.chat_feature_action(actor uuid, request_id uuid, action text, content text default '', expected_revision integer default 0)
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
  insert into chat_feature_messages(request_id,author_id,author_label,body) values(r.id,actor,case when member_role='owner' then 'Rob' else 'Jammie' end,content);
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
-- Atomic claim; never automatically reclaim unfinished work.
create function public.claim_chat_feature(worker uuid) returns setof public.chat_feature_requests
language sql security invoker set search_path=public as $$
 update chat_feature_requests set status='in_progress',claimed_at=now(),worker_token=worker
 where id=(select id from chat_feature_requests where status='approved' and approved_by is not null
 order by approved_at for update skip locked limit 1) returning *;
$$;
revoke all on function public.claim_chat_feature(uuid) from public,anon,authenticated;
grant execute on function public.claim_chat_feature(uuid) to service_role;

-- Worker updates and thread notifications commit together.
create function public.update_chat_feature_work(request_id uuid, worker uuid, state text, message text)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if state not in ('progress','ready','blocked') or length(trim(message)) not between 1 and 12000 then raise exception 'invalid_update'; end if;
 perform 1 from chat_feature_requests where id=request_id and worker_token=worker and status='in_progress' for update;
 if not found then raise exception 'claim_not_owned'; end if;
 if state<>'progress' then
  update chat_feature_requests set status=state,outcome=message where id=request_id;
 end if;
 insert into chat_feature_messages(request_id,author_label,kind,body) values(request_id,'Codex desktop','system',message);
end $$;
revoke all on function public.update_chat_feature_work(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_chat_feature_work(uuid,uuid,text,text) to service_role;
