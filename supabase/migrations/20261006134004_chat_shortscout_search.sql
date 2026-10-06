-- Add SS to the existing bounded search/index paths. Legacy all remains LB + SOCIAL.
-- Search is SECURITY INVOKER (direct callers retain RLS); the app validates every
-- selected room with current server entitlements before its service-role RPC.
create or replace function public.queue_longboard_chat_embedding() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.deleted_at is not null or new.removed or new.room_slug not in ('main','social','shortscout') then
  delete from public.longboard_chat_embeddings where message_id=new.id;
 else
  insert into public.longboard_chat_embeddings(message_id,content_hash)
  values(new.id,md5(new.author_label || E'\n' || new.body))
  on conflict(message_id) do update set content_hash=excluded.content_hash,embedding=null,
   lease_id=null,available_at=now(),attempts=0,indexed_at=null,input_tokens=0;
 end if;
 return new;
end; $$;


-- Eligibility changes also revoke an in-flight embedding lease.
drop trigger longboard_chat_embedding_update on public.longboard_chat_messages;
create trigger longboard_chat_embedding_update after update of body,author_label,room_slug,deleted_at,removed on public.longboard_chat_messages
for each row when (old.body is distinct from new.body or old.author_label is distinct from new.author_label or old.room_slug is distinct from new.room_slug or old.deleted_at is distinct from new.deleted_at or old.removed is distinct from new.removed)
execute function public.queue_longboard_chat_embedding();

-- Existing messages enter the same 32-row queue; this migration makes no provider calls.
insert into public.longboard_chat_embeddings(message_id,content_hash)
select id,md5(author_label || E'\n' || body) from public.longboard_chat_messages
where room_slug='shortscout' and deleted_at is null and not removed
on conflict(message_id) do nothing;

create or replace function public.claim_longboard_chat_embeddings()
returns table(message_id uuid,content_hash text,lease_id uuid,content text)
language sql volatile security invoker set search_path=public as $$
 with pending as (
  select e.message_id from public.longboard_chat_embeddings e
  join public.longboard_chat_messages m on m.id=e.message_id
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout')
   and e.content_hash=md5(m.author_label || E'\n' || m.body) and e.embedding is null and e.attempts<8 and e.available_at<=now()
  order by e.available_at,e.message_id limit 32 for update of e skip locked
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

create or replace function public.search_longboard_chat(p_query text,p_room text default 'main',p_before timestamptz default null,p_before_id uuid default null)
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
 select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m
 where not m.removed and m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 and m.room_slug in ('main','social','shortscout') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
 and m.search_document @@ websearch_to_tsquery('simple',p_query)
 and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
 order by m.created_at desc,m.id desc limit 21;
$$;

create or replace function public.search_longboard_chat_semantic(p_query text,p_embedding extensions.vector(1536),p_room text default 'main')
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public,extensions as $$
 with semantic as (
  select m.id,row_number() over(order by e.embedding <=> p_embedding,m.id) as rank
  from public.longboard_chat_embeddings e join public.longboard_chat_messages m on m.id=e.message_id
  where not m.removed and m.deleted_at is null and e.embedding is not null and e.model='text-embedding-3-small'
   and m.room_slug in ('main','social','shortscout') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
   and e.content_hash=md5(m.author_label || E'\n' || m.body)
   and e.embedding <=> p_embedding < 0.75
  order by e.embedding <=> p_embedding,m.id limit 40
 ), keywords as (
  select m.id,row_number() over(order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id) as rank
  from public.longboard_chat_messages m
  where not m.removed and m.deleted_at is null and m.room_slug in ('main','social','shortscout') and m.room_slug=any(case p_room when 'all' then array['main','social'] when 'lb-social' then array['main','social'] when 'ss-social' then array['shortscout','social'] else array[p_room] end)
   and m.search_document @@ websearch_to_tsquery('simple',p_query)
  order by ts_rank_cd(m.search_document,websearch_to_tsquery('simple',p_query)) desc,m.created_at desc,m.id limit 40
 ), scores as (
  select coalesce(s.id,k.id) id,coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+k.rank),0) score
  from semantic s full join keywords k on k.id=s.id
 ) select m.id,m.room_slug,m.author_label,m.body,m.created_at
 from scores s join public.longboard_chat_messages m on m.id=s.id
 where not m.removed and m.deleted_at is null and char_length(btrim(p_query)) between 2 and 200
 order by s.score desc,m.created_at desc,m.id limit 20;
$$;

