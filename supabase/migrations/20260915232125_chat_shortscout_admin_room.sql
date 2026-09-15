alter table public.longboard_chat_room_state drop constraint longboard_chat_room_slug_check;
alter table public.longboard_chat_room_state add constraint longboard_chat_room_slug_check check(room_slug in ('main','social','shortscout'));
insert into public.longboard_chat_room_state(id,room_slug) values(3,'shortscout');

-- Match the trusted profiles role used by server authentication. Existing RPCs
-- and realtime message reads inherit this restriction through source-table RLS.
alter policy "members read chat messages" on public.longboard_chat_messages
using (exists (select 1 from public.profiles where id=(select auth.uid()) and (room_slug in ('main','social') or (room_slug='shortscout' and role='admin'))));
alter policy "members read chat reactions" on public.longboard_chat_reactions
using (exists (select 1 from public.longboard_chat_messages m where m.id=message_id));

-- Also guard privileged API writes against accidentally omitting the route gate.
create function public.enforce_shortscout_chat_admin() returns trigger
language plpgsql security invoker set search_path=public as $$
declare target_room text; target_member uuid;
begin
 if tg_table_name='longboard_chat_messages' then
  target_room:=new.room_slug; target_member:=new.member_id;
 else
  select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
  target_member:=new.guest_id;
 end if;
 if target_room='shortscout' and not exists (
  select 1 from public.longboard_chat_members m join public.profiles p on p.id=m.user_id
  where m.id=target_member and p.role='admin'
 ) then raise exception 'shortscout_admin_only'; end if;
 return new;
end; $$;
revoke all on function public.enforce_shortscout_chat_admin() from public,anon,authenticated;
grant execute on function public.enforce_shortscout_chat_admin() to service_role;
create trigger shortscout_message_admin before insert or update of body on public.longboard_chat_messages
for each row execute function public.enforce_shortscout_chat_admin();
create trigger shortscout_reaction_admin before insert or update on public.longboard_chat_reactions
for each row execute function public.enforce_shortscout_chat_admin();

-- SHORTSCOUT stays outside the Main/Social search index and scheduled AI processing.
-- Explicitly constrain keyword all-room searches as semantic search already does.
create or replace function public.search_longboard_chat(p_query text,p_room text default 'main',p_before timestamptz default null,p_before_id uuid default null)
returns table(id uuid,room_slug text,author_label text,body text,created_at timestamptz)
language sql stable security invoker set search_path=public as $$
 select m.id,m.room_slug,m.author_label,m.body,m.created_at from public.longboard_chat_messages m
 where char_length(btrim(p_query)) between 2 and 200
 and m.room_slug in ('main','social') and (p_room='all' or m.room_slug=p_room)
 and m.search_document @@ websearch_to_tsquery('simple',p_query)
 and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
 order by m.created_at desc,m.id desc limit 21;
$$;
