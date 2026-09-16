-- Shared room cache is never readable by browser roles; API checks room access first.
create table public.chat_room_summary_cache (
 room_slug text primary key check(room_slug in ('main','social','shortscout')),
 fingerprint text not null, body text, generated_at timestamptz,
 worker_token uuid, lease_until timestamptz
);
create table public.chat_summary_requests (
 account_id uuid primary key references public.chat_accounts(id) on delete cascade,
 last_at timestamptz not null default now()
);
-- Private assistant deliveries are independent of human-to-human DM requests.
create table public.chat_summary_deliveries (
 id uuid primary key default gen_random_uuid(), seq bigint generated always as identity unique,
 account_id uuid not null references public.chat_accounts(id) on delete cascade,
 client_id uuid not null, room_slug text not null check(room_slug in ('main','social','shortscout')),
 body text not null check(length(body) between 1 and 6000), created_at timestamptz not null default now(), read_at timestamptz,
 unique(account_id,client_id)
);
create index chat_summary_delivery_inbox on public.chat_summary_deliveries(account_id,seq desc);
alter table public.chat_room_summary_cache enable row level security;
alter table public.chat_summary_requests enable row level security;
alter table public.chat_summary_deliveries enable row level security;
revoke all on public.chat_room_summary_cache,public.chat_summary_requests,public.chat_summary_deliveries from public,anon,authenticated;
grant all on public.chat_room_summary_cache,public.chat_summary_requests,public.chat_summary_deliveries to service_role;
grant usage,select on sequence public.chat_summary_deliveries_seq_seq to service_role;

create function public.reserve_chat_summary(actor uuid) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 insert into chat_summary_requests(account_id) values(actor)
 on conflict(account_id) do update set last_at=now() where chat_summary_requests.last_at<now()-interval '15 seconds';
 return found;
end $$;
create function public.claim_chat_summary(room text, snapshot text, worker uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare cached chat_room_summary_cache;
begin
 if worker is null or snapshot is null or snapshot !~ '^[0-9a-f]{64}$' then raise exception 'invalid_summary_claim'; end if;
 insert into chat_room_summary_cache(room_slug,fingerprint) values(room,snapshot) on conflict do nothing;
 select * into cached from chat_room_summary_cache where room_slug=room for update;
 if cached.fingerprint=snapshot and cached.body is not null and cached.generated_at>now()-interval '10 minutes' then
 return jsonb_build_object('state','cached','body',cached.body,'generated_at',cached.generated_at); end if;
 if cached.lease_until>now() then return jsonb_build_object('state','busy'); end if;
 update chat_room_summary_cache set fingerprint=snapshot,body=null,generated_at=null,worker_token=worker,lease_until=now()+interval '90 seconds' where room_slug=room;
 return jsonb_build_object('state','generate');
end $$;
create function public.finish_chat_summary(room text, snapshot text, worker uuid, summary text) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 if summary is not null and length(trim(summary)) not between 1 and 4500 then raise exception 'invalid_summary'; end if;
 update chat_room_summary_cache set body=summary,generated_at=case when summary is not null then now() end,worker_token=null,lease_until=null
 where room_slug=room and fingerprint=snapshot and worker_token=worker and lease_until>now();
 return found;
end $$;
revoke all on function public.reserve_chat_summary(uuid),public.claim_chat_summary(text,text,uuid),public.finish_chat_summary(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_chat_summary(uuid),public.claim_chat_summary(text,text,uuid),public.finish_chat_summary(text,text,uuid,text) to service_role;
