-- Private device capabilities and a transactional, per-device outbox.
create table public.chat_push_subscriptions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.chat_accounts(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048), p256dh text not null, auth text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_test_at timestamptz
);
create index chat_push_account on public.chat_push_subscriptions(account_id);
create table public.chat_push_jobs (
 id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.chat_push_subscriptions(id) on delete cascade,
 kind text not null check(kind in ('dm','room')), source_id uuid not null,
 created_at timestamptz not null default now(), available_at timestamptz not null default now(), attempts integer not null default 0,
 lease_token uuid, lease_until timestamptz, completed_at timestamptz, unique(subscription_id,kind,source_id)
);
create index chat_push_pending on public.chat_push_jobs(available_at) where completed_at is null;
alter table public.chat_push_subscriptions enable row level security;
alter table public.chat_push_jobs enable row level security;
revoke all on public.chat_push_subscriptions, public.chat_push_jobs from public,anon,authenticated;
grant all on public.chat_push_subscriptions, public.chat_push_jobs to service_role;
create function public.save_chat_push_subscription(actor uuid,p_endpoint text,p_p256dh text,p_auth text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,7));
 if exists(select 1 from public.chat_push_subscriptions where endpoint=p_endpoint and account_id<>actor) then raise exception 'endpoint_owned';end if;
 if exists(select 1 from public.chat_push_subscriptions where account_id=actor and updated_at>now()-interval '2 seconds') then raise exception 'push_rate_limited';end if;
 if (select count(*) from public.chat_push_subscriptions where account_id=actor)>=10 and not exists(select 1 from public.chat_push_subscriptions where account_id=actor and endpoint=p_endpoint) then raise exception 'device_limit';end if;
 insert into public.chat_push_subscriptions(account_id,endpoint,p256dh,auth) values(actor,p_endpoint,p_p256dh,p_auth)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now() where chat_push_subscriptions.account_id=actor;
end $$;
create function public.test_chat_push_subscription(actor uuid,p_endpoint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.chat_push_subscriptions;
begin
 update public.chat_push_subscriptions set last_test_at=now() where account_id=actor and endpoint=p_endpoint and (last_test_at is null or last_test_at<now()-interval '30 seconds') returning * into s;
 if s.id is null then return null;end if;
 return jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth));
end $$;
create function public.queue_chat_push() returns trigger language plpgsql security invoker set search_path='' as $$
declare recipient uuid;
begin
 if tg_table_name='chat_room_mentions' then
  -- Announcements are a later opt-in; only personal alerts in the first version.
  if new.room_slug not in ('main','social','shortscout') then return new;end if;
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'room',new.id from public.chat_push_subscriptions where account_id=new.account_id on conflict do nothing;
 else
  select m.user_id into recipient from public.longboard_chat_conversations c join public.longboard_chat_members m on m.id=case when c.requester_id=new.sender_id then c.recipient_id else c.requester_id end where c.id=new.conversation_id and c.status='accepted';
  insert into public.chat_push_jobs(subscription_id,kind,source_id) select id,'dm',new.id from public.chat_push_subscriptions where account_id=recipient on conflict do nothing;
 end if;return new;
end $$;
create trigger chat_push_room after insert on public.chat_room_mentions for each row execute function public.queue_chat_push();
create trigger chat_push_dm after insert on public.longboard_chat_direct_messages for each row execute function public.queue_chat_push();
-- Returns no content and reevaluates current entitlement, unread state and blocks.
create function public.chat_push_target(kind text,source uuid,actor uuid) returns text
language sql stable security invoker set search_path='' as $$
 select case when kind='dm' then (
  select '/chat?dm='||c.id from public.longboard_chat_direct_messages d
  join public.longboard_chat_conversations c on c.id=d.conversation_id
  join public.longboard_chat_members me on me.user_id=actor and me.id in(c.requester_id,c.recipient_id)
  where d.id=source and d.deleted_at is null and c.status='accepted' and d.sender_id<>me.id
  and public.chat_account_has_room(actor,'social')
  and exists(select 1 from public.longboard_chat_members sender where sender.id=d.sender_id and public.chat_account_has_room(sender.user_id,'social'))
  and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=d.sender_id) or (b.blocked_id=me.id and b.blocker_id=d.sender_id))
 ) else (
  select '/chat?room='||n.room_slug||'&thread='||coalesce(n.thread_root_id,m.reply_to_id,m.id)
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  join public.longboard_chat_members me on me.user_id=actor
  left join public.longboard_chat_messages root on root.id=n.thread_root_id
  left join public.chat_activity_preferences p on p.account_id=actor
  where n.id=source and n.account_id=actor and n.read_at is null and m.member_id is distinct from me.id
  and public.chat_account_has_room(actor,n.room_slug) and (n.category<>'reply' or coalesce(p.replies,true))
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id in(m.member_id,root.member_id)) or (b.blocked_id=me.id and b.blocker_id in(m.member_id,root.member_id)))
 ) end;
$$;
create function public.claim_chat_push_job(worker uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.chat_push_jobs;s public.chat_push_subscriptions;destination text;
begin
 -- Expired events cannot create stale notification storms; prune finished rows.
 delete from public.chat_push_jobs where created_at<now()-interval '7 days';
 for j in select * from public.chat_push_jobs where completed_at is null and available_at<=now() and (lease_until is null or lease_until<now()) order by available_at for update skip locked limit 30 loop
  select * into s from public.chat_push_subscriptions where id=j.subscription_id;
  destination:=public.chat_push_target(j.kind,j.source_id,s.account_id);
  if destination is null or j.attempts>=5 or j.created_at<now()-interval '5 minutes' then update public.chat_push_jobs set completed_at=now() where id=j.id;continue;end if;
  update public.chat_push_jobs set lease_token=worker,lease_until=now()+interval '90 seconds',attempts=attempts+1 where id=j.id;
  return jsonb_build_object('id',j.id,'url',destination,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)));
 end loop;return null;
end $$;
create function public.finish_chat_push_job(job_id uuid,worker uuid,outcome text) returns void language plpgsql security invoker set search_path='' as $$
declare j public.chat_push_jobs;
begin
 select * into j from public.chat_push_jobs where id=job_id and lease_token=worker and lease_until>now() for update;
 if j.id is null then return;end if;
 if outcome='expired' then delete from public.chat_push_subscriptions where id=j.subscription_id;return;end if;
 update public.chat_push_jobs set completed_at=case when outcome in ('sent','discard') then now() else null end, available_at=now()+make_interval(secs=>least(120,10*j.attempts)),lease_token=null,lease_until=null where id=j.id;
end $$;
revoke all on function public.save_chat_push_subscription(uuid,text,text,text),public.test_chat_push_subscription(uuid,text),public.queue_chat_push(),public.chat_push_target(text,uuid,uuid),public.claim_chat_push_job(uuid),public.finish_chat_push_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_chat_push_subscription(uuid,text,text,text),public.test_chat_push_subscription(uuid,text),public.queue_chat_push(),public.chat_push_target(text,uuid,uuid),public.claim_chat_push_job(uuid),public.finish_chat_push_job(uuid,uuid,text) to service_role;
