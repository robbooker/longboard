-- Short chat messages are individual source chunks. Context is fetched from originals.
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated,service_role;
create table public.longboard_chat_embeddings (
 message_id uuid primary key references public.longboard_chat_messages(id) on delete cascade,
 content_hash text not null,
 embedding extensions.vector(1536),
 model text not null default 'text-embedding-3-small',
 lease_id uuid,
 available_at timestamptz not null default now(),
 attempts integer not null default 0,
 indexed_at timestamptz,
 input_tokens integer not null default 0
);
alter table public.longboard_chat_embeddings enable row level security;
revoke all on public.longboard_chat_embeddings from anon,authenticated;
grant select on public.longboard_chat_embeddings to authenticated;
grant all on public.longboard_chat_embeddings to service_role;
create policy "members read source embeddings" on public.longboard_chat_embeddings for select to authenticated
using (exists (select 1 from public.longboard_chat_messages m where m.id=message_id));
create index longboard_chat_embedding_queue_idx on public.longboard_chat_embeddings(available_at,message_id) where embedding is null;

create function public.queue_longboard_chat_embedding() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.room_slug in ('main','social') then
  insert into public.longboard_chat_embeddings(message_id,content_hash)
  values(new.id,md5(new.author_label || E'\n' || new.body))
  on conflict(message_id) do update set content_hash=excluded.content_hash,embedding=null,
   lease_id=null,available_at=now(),attempts=0,indexed_at=null,input_tokens=0;
 end if;
 return new;
end; $$;
revoke all on function public.queue_longboard_chat_embedding() from public,anon,authenticated;
grant execute on function public.queue_longboard_chat_embedding() to service_role;
create trigger longboard_chat_embedding_insert after insert on public.longboard_chat_messages
for each row execute function public.queue_longboard_chat_embedding();
create trigger longboard_chat_embedding_update after update of body,author_label on public.longboard_chat_messages
for each row when (old.body is distinct from new.body or old.author_label is distinct from new.author_label)
execute function public.queue_longboard_chat_embedding();
insert into public.longboard_chat_embeddings(message_id,content_hash)
select id,md5(author_label || E'\n' || body) from public.longboard_chat_messages where room_slug in ('main','social');

-- Atomic leases survive worker crashes and prevent overlapping cron batches.
create function public.claim_longboard_chat_embeddings()
returns table(message_id uuid,content_hash text,lease_id uuid,content text)
language sql volatile security invoker set search_path=public as $$
 with pending as (
  select e.message_id from public.longboard_chat_embeddings e
  where e.embedding is null and e.attempts<8 and e.available_at<=now()
  order by e.available_at,e.message_id limit 32 for update skip locked
 ), claimed as (
  update public.longboard_chat_embeddings e set lease_id=gen_random_uuid(),
   available_at=now()+interval '5 minutes',attempts=e.attempts+1
  from pending p where e.message_id=p.message_id
  returning e.message_id,e.content_hash,e.lease_id
 ) select c.message_id,c.content_hash,c.lease_id,m.author_label || E'\n' || m.body
 from claimed c join public.longboard_chat_messages m on m.id=c.message_id;
$$;
revoke all on function public.claim_longboard_chat_embeddings() from public,anon,authenticated;
grant execute on function public.claim_longboard_chat_embeddings() to service_role;

-- Distributed per-member budget, never writable by browsers. One row per user.
create table public.longboard_chat_search_budget (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_start timestamptz not null default now(), requests integer not null default 1
);
alter table public.longboard_chat_search_budget enable row level security;
revoke all on public.longboard_chat_search_budget from public,anon,authenticated;
grant all on public.longboard_chat_search_budget to service_role;
create function public.take_longboard_chat_search_budget(p_user uuid) returns boolean
language plpgsql volatile security invoker set search_path=public as $$
declare n integer;
begin
 insert into public.longboard_chat_search_budget(user_id) values(p_user)
 on conflict(user_id) do update set
 requests=case when longboard_chat_search_budget.window_start<now()-interval '1 hour' then 1 else longboard_chat_search_budget.requests+1 end,
 window_start=case when longboard_chat_search_budget.window_start<now()-interval '1 hour' then now() else longboard_chat_search_budget.window_start end
 returning requests into n;
 return n<=30;
end; $$;
revoke all on function public.take_longboard_chat_search_budget(uuid) from public,anon,authenticated;
grant execute on function public.take_longboard_chat_search_budget(uuid) to service_role;

-- Reciprocal rank fusion keeps literal ticker matches alongside semantic matches.
-- Every source read uses the caller's RLS. No service-role retrieval and no DMs.
create function public.search_longboard_chat_semantic(p_query text,p_embedding extensions.vector(1536),p_room text default 'main')
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public,extensions as $$
 with semantic as (
  select m.id,row_number() over(order by e.embedding <=> p_embedding,m.id) as rank
  from public.longboard_chat_embeddings e join public.longboard_chat_messages m on m.id=e.message_id
  where e.embedding is not null and e.model='text-embedding-3-small'
   and m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
   and e.content_hash=md5(m.author_label || E'\n' || m.body)
   and e.embedding <=> p_embedding < 0.75
  order by e.embedding <=> p_embedding,m.id limit 40
 ), keywords as (
  select m.id,row_number() over(order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id) as rank
  from public.longboard_chat_messages m
  where m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
   and m.search_document @@ websearch_to_tsquery('simple',p_query)
  order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id limit 40
 ), scores as (
  select coalesce(s.id,k.id) id,coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+k.rank),0) score
  from semantic s full join keywords k on k.id=s.id
 ) select m.id,m.room_slug,m.author_label,m.body,m.created_at
 from scores s join public.longboard_chat_messages m on m.id=s.id
 where char_length(btrim(p_query)) between 2 and 200
 order by s.score desc,m.created_at desc,m.id limit 20;
$$;
revoke all on function public.search_longboard_chat_semantic(text,extensions.vector,text) from public,anon;
grant execute on function public.search_longboard_chat_semantic(text,extensions.vector,text) to authenticated;
