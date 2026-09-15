-- Remove anonymous access to both existing and future room history/realtime.
revoke all on public.longboard_chat_messages, public.longboard_chat_reactions from anon;
drop policy "public reads Longboard chat messages" on public.longboard_chat_messages;
drop policy "public reads Longboard chat reactions" on public.longboard_chat_reactions;
create policy "members read chat messages" on public.longboard_chat_messages for select to authenticated
using (exists (select 1 from public.profiles where id = (select auth.uid())));
create policy "members read chat reactions" on public.longboard_chat_reactions for select to authenticated
using (exists (select 1 from public.profiles where id = (select auth.uid())));

-- Historical guest authors remain intact. Only new human posts require linking.
create function public.require_longboard_chat_member() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.bot_slug is null and new.member_id is null then
    raise exception 'chat_member_required';
  end if;
  return new;
end;
$$;
revoke all on function public.require_longboard_chat_member() from public, anon, authenticated;
grant execute on function public.require_longboard_chat_member() to service_role;
create trigger longboard_chat_messages_require_member before insert on public.longboard_chat_messages
for each row execute function public.require_longboard_chat_member();

alter table public.longboard_chat_messages add column search_document tsvector
  generated always as (to_tsvector('simple', author_label || ' ' || body)) stored;
create index longboard_chat_messages_search_idx on public.longboard_chat_messages using gin(search_document);

-- SECURITY INVOKER preserves the caller's RLS. No DM table is searched.
create function public.search_longboard_chat(p_query text, p_room text default 'main', p_before timestamptz default null, p_before_id uuid default null)
returns table(id uuid, room_slug text, author_label text, body text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.id,m.room_slug,m.author_label,m.body,m.created_at
  from public.longboard_chat_messages m
  where char_length(btrim(p_query)) between 2 and 200
    and (p_room = 'all' or m.room_slug=p_room)
    and m.search_document @@ websearch_to_tsquery('simple', p_query)
    and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
  order by m.created_at desc,m.id desc limit 21;
$$;
revoke all on function public.search_longboard_chat(text,text,timestamptz,uuid) from public,anon;
grant execute on function public.search_longboard_chat(text,text,timestamptz,uuid) to authenticated;

create function public.longboard_chat_search_context(p_message uuid)
returns table(id uuid, room_slug text, author_label text, body text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with target as (select * from public.longboard_chat_messages where id=p_message),
  earlier as (
    select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m,target t
    where m.room_slug=t.room_slug and (m.created_at,m.id)<(t.created_at,t.id)
    order by m.created_at desc,m.id desc limit 5
  ), later as (
    select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m,target t
    where m.room_slug=t.room_slug and (m.created_at,m.id)>(t.created_at,t.id)
    order by m.created_at,m.id limit 5
  )
  select * from (
    select * from earlier union all
    select id,room_slug,author_label,body,created_at from target union all
    select * from later
  ) context order by created_at,id;
$$;
revoke all on function public.longboard_chat_search_context(uuid) from public,anon;
grant execute on function public.longboard_chat_search_context(uuid) to authenticated;
