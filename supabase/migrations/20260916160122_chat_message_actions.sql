alter table public.longboard_chat_messages add column edited_at timestamptz;
create table public.chat_message_actions (
 id bigint generated always as identity primary key,
 message_id uuid not null,
 room_slug text not null,
 actor_id uuid references public.chat_accounts(id) on delete set null,
 action text not null check(action in ('edit','delete','admin_delete')),
 created_at timestamptz not null default now()
);
alter table public.chat_message_actions enable row level security;
revoke all on public.chat_message_actions from public,anon,authenticated;
grant select,insert on public.chat_message_actions to service_role;
grant usage on sequence public.chat_message_actions_id_seq to service_role;

create function public.change_chat_message(p_actor uuid,p_message uuid,p_room text,p_action text,p_body text default null,p_expected_body text default null,p_admin boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_messages; own boolean; moderator boolean;
begin
 if p_action not in ('edit','delete') or p_action is null then raise exception 'invalid_action'; end if;
 if not public.chat_account_has_room(p_actor,p_room) then raise exception 'room_forbidden'; end if;
 select * into m from public.longboard_chat_messages where id=p_message and room_slug=p_room for update;
 if not found then raise exception 'message_not_found'; end if;
 own:=m.member_id is not null and exists(select 1 from public.longboard_chat_members where id=m.member_id and user_id=p_actor);
 moderator:=p_admin and exists(select 1 from public.profiles where id=p_actor and role='admin');
 if not own and not (p_action='delete' and moderator) then raise exception 'message_forbidden'; end if;
 if p_action='edit' then
  if m.bot_slug is not null then raise exception 'message_forbidden'; end if;
  if not exists(select 1 from public.longboard_chat_room_state where room_slug=p_room and is_open) then raise exception 'chat_paused'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 600 then raise exception 'invalid_message'; end if;
  if p_expected_body is null or m.body<>p_expected_body then raise exception 'message_changed'; end if;
  if m.body=btrim(p_body) then return to_jsonb(m); end if;
  update public.longboard_chat_messages set body=btrim(p_body),edited_at=now() where id=m.id returning * into m;
 else
  delete from public.longboard_chat_messages where id=m.id;
 end if;
 insert into public.chat_message_actions(message_id,room_slug,actor_id,action)
 values(m.id,m.room_slug,p_actor,case when p_action='delete' and not own then 'admin_delete' else p_action end);
 if p_action='delete' then return jsonb_build_object('deletedId',m.id); end if;
 return to_jsonb(m);
end; $$;
revoke all on function public.change_chat_message(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.change_chat_message(uuid,uuid,text,text,text,text,boolean) to service_role;
