-- Publishing authorization is separate from approval to develop a proposal.
create table public.chat_feature_releases (
 request_id uuid primary key references public.chat_feature_requests(id) on delete cascade,
 repository text not null default 'robbooker/longboard' check(repository='robbooker/longboard'),
 pr_number integer not null check(pr_number>0), head_sha text not null check(head_sha ~ '^[0-9a-f]{40}$'),
 version integer not null default 1 check(version>0),
 state text not null default 'ready' check(state in ('ready','approved','publishing','failed','published')),
 approved_by uuid references public.chat_accounts(id), approved_at timestamptz,
 worker_token uuid, claimed_at timestamptz,
 merge_sha text check(merge_sha ~ '^[0-9a-f]{40}$'), deployment_id text,
 outcome text, updated_at timestamptz not null default now(),
 check(state='ready' or (approved_by is not null and approved_at is not null)),
 check(state not in ('publishing','published') or (worker_token is not null and claimed_at is not null)),
 check(state<>'published' or (merge_sha is not null and deployment_id is not null))
);
alter table public.chat_feature_releases enable row level security;
revoke all on public.chat_feature_releases from public,anon,authenticated;
grant all on public.chat_feature_releases to service_role;

-- Only the existing development claim can register or replace the reviewed artifact.
create function public.prepare_chat_feature_release(feature uuid, worker uuid, pr integer, sha text, summary text)
returns integer language plpgsql security invoker set search_path=public as $$
declare r chat_feature_requests; release chat_feature_releases; next_version integer;
begin
 if worker is null or pr is null or pr<1 or sha is null or sha !~ '^[0-9a-f]{40}$' or coalesce(length(trim(summary)),0) not between 1 and 12000 then raise exception 'invalid_release'; end if;
 select * into r from chat_feature_requests where id=feature for update;
 if r.id is null or r.worker_token is distinct from worker or r.status not in ('in_progress','ready') then raise exception 'claim_not_owned'; end if;
 select * into release from chat_feature_releases where request_id=feature for update;
 if release.state in ('publishing','published') then raise exception 'release_locked'; end if;
 if release.pr_number=pr and release.head_sha=sha then return release.version; end if;
 next_version:=coalesce(release.version,0)+1;
 insert into chat_feature_releases(request_id,pr_number,head_sha,version,outcome) values(feature,pr,sha,next_version,summary)
 on conflict(request_id) do update set pr_number=excluded.pr_number,head_sha=excluded.head_sha,version=excluded.version,
 state='ready',approved_by=null,approved_at=null,worker_token=null,claimed_at=null,merge_sha=null,deployment_id=null,outcome=excluded.outcome,updated_at=now();
 update chat_feature_requests set status='ready',outcome=summary where id=feature;
 insert into chat_feature_messages(request_id,author_label,kind,body) values(feature,'Codex desktop','system',
 format('Ready for merge/publish approval: https://github.com/robbooker/longboard/pull/%s, version %s, commit %s. Any previous publishing approval has been cleared. %s',pr,next_version,sha,summary));
 return next_version;
end $$;

create function public.approve_chat_feature_release(actor uuid, feature uuid, expected_version integer, expected_sha text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare release chat_feature_releases;
begin
 if not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 perform 1 from chat_feature_requests where id=feature and status='ready' for update;
 if not found then raise exception 'request_not_ready'; end if;
 select * into release from chat_feature_releases where request_id=feature for update;
 if release.request_id is null or release.version is distinct from expected_version or release.head_sha is distinct from expected_sha or release.state not in ('ready','failed') then raise exception 'release_changed_or_locked'; end if;
 update chat_feature_releases set state='approved',approved_by=actor,approved_at=now(),worker_token=null,claimed_at=null,merge_sha=null,deployment_id=null,outcome=null,updated_at=now() where request_id=feature;
 insert into chat_feature_messages(request_id,author_id,author_label,kind,body) values(feature,actor,'Rob','system',
 format('Rob explicitly approved merging and publishing PR #%s, version %s, commit %s to the live Longboard site. Waiting for worker pickup.',release.pr_number,release.version,release.head_sha));
 return feature;
end $$;

create function public.claim_chat_feature_release(worker uuid) returns setof public.chat_feature_releases
language sql security invoker set search_path=public as $$
 update chat_feature_releases set state='publishing',worker_token=worker,claimed_at=now(),updated_at=now()
 where request_id=(select l.request_id from chat_feature_releases l
 where worker is not null and l.state='approved'
 and exists(select 1 from chat_feature_members m where m.account_id=l.approved_by and m.role='owner')
 and exists(select 1 from chat_feature_requests r where r.id=l.request_id and r.status='ready')
 order by l.approved_at for update of l skip locked limit 1) returning *;
$$;

create function public.update_chat_feature_release(feature uuid, worker uuid, expected_sha text, result text, message text, merged_commit text default null, deployment text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare release chat_feature_releases;
begin
 if result is null or result not in ('progress','failed','published') or coalesce(length(trim(message)),0) not between 1 and 12000 then raise exception 'invalid_update'; end if;
 perform 1 from chat_feature_requests where id=feature and status='ready' for update;
 if not found then raise exception 'request_not_ready'; end if;
 select * into release from chat_feature_releases where request_id=feature for update;
 if worker is null or release.request_id is null or release.worker_token is distinct from worker or release.head_sha is distinct from expected_sha or release.state<>'publishing' then raise exception 'release_claim_not_owned'; end if;
 if not exists(select 1 from chat_feature_members where account_id=release.approved_by and role='owner') then raise exception 'approval_revoked'; end if;
 if result='published' and (merged_commit is null or merged_commit !~ '^[0-9a-f]{40}$' or deployment is null or deployment !~ '^dpl_[A-Za-z0-9]+$') then raise exception 'verification_evidence_required'; end if;
 update chat_feature_releases set state=case when result='progress' then state else result end,outcome=message,
 merge_sha=case when result='published' then merged_commit else merge_sha end,
 deployment_id=case when result='published' then deployment else deployment_id end,updated_at=now() where request_id=feature;
 if result='published' then update chat_feature_requests set status='done',outcome=message where id=feature; end if;
 insert into chat_feature_messages(request_id,author_label,kind,body) values(feature,'Codex desktop','system',message);
end $$;

-- Old manual completion remains available only for legacy requests without a release record.
create or replace function public.publish_chat_feature(actor uuid, feature uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 perform 1 from chat_feature_requests where id=feature for update;
 if exists(select 1 from chat_feature_releases where request_id=feature) then raise exception 'release_verification_required'; end if;
 update chat_feature_requests set status='done' where id=feature and status='ready';
 if not found then raise exception 'request_not_ready'; end if;
 insert into chat_feature_messages(request_id,author_id,author_label,kind,body) values(feature,actor,'Rob','system','Rob confirmed this feature is published and verified.');
 return feature;
end $$;

create function public.notify_chat_feature_release() returns trigger
language plpgsql security invoker set search_path=public as $$
declare recipient record; label text;
begin
 if new.state is not distinct from old.state then return new; end if;
 label:=case new.state when 'approved' then 'Approved for publishing' when 'publishing' then 'Publishing started' when 'failed' then 'Publishing needs attention' end;
 if label is null then return new; end if;
 for recipient in select account_id,role from chat_feature_members loop
  if new.state='failed' and recipient.role<>'owner' then continue; end if;
  perform emit_chat_feature_notification(recipient.account_id,new.request_id,'release:'||gen_random_uuid(),'status',label,new.state='failed');
 end loop;
 return new;
end $$;
create trigger chat_feature_release_notifications after update of state on public.chat_feature_releases for each row execute function public.notify_chat_feature_release();

revoke all on function public.prepare_chat_feature_release(uuid,uuid,integer,text,text),public.approve_chat_feature_release(uuid,uuid,integer,text),public.claim_chat_feature_release(uuid),public.update_chat_feature_release(uuid,uuid,text,text,text,text,text),public.notify_chat_feature_release() from public,anon,authenticated;
grant execute on function public.prepare_chat_feature_release(uuid,uuid,integer,text,text),public.approve_chat_feature_release(uuid,uuid,integer,text),public.claim_chat_feature_release(uuid),public.update_chat_feature_release(uuid,uuid,text,text,text,text,text),public.notify_chat_feature_release() to service_role;
