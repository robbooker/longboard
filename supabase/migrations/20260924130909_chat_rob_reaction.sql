-- Add one fixed reaction key without changing existing rows, target authorization,
-- locking, legacy likes, RLS or service-role-only grants.
alter table public.chat_message_reaction_choices
 drop constraint chat_message_reaction_choices_emoji_check;
alter table public.chat_message_reaction_choices
 add constraint chat_message_reaction_choices_emoji_check
 check (emoji in ('like','heart','laugh','rob'));

create or replace function public.set_chat_message_reaction(p_actor uuid,p_room text,p_conversation uuid,p_message uuid,p_emoji text,p_active boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
 if p_emoji is null or p_emoji not in ('like','heart','laugh','rob') or p_active is null then raise exception 'invalid_reaction'; end if;
 actor:=public.check_chat_reaction_target(p_actor,p_room,p_conversation,p_message,true);
 if p_room is not null and p_emoji='like' then
  insert into public.longboard_chat_reactions(message_id,guest_id,active,updated_at) values(p_message,actor,p_active,clock_timestamp())
  on conflict(message_id,guest_id) do update set active=excluded.active,updated_at=excluded.updated_at;
 elsif p_room is not null then
  insert into public.chat_message_reaction_choices(room_message_id,member_id,emoji,active) values(p_message,actor,p_emoji,p_active)
  on conflict(room_message_id,member_id,emoji) do update set active=excluded.active,updated_at=clock_timestamp();
 else
  insert into public.chat_message_reaction_choices(dm_message_id,member_id,emoji,active) values(p_message,actor,p_emoji,p_active)
  on conflict(dm_message_id,member_id,emoji) do update set active=excluded.active,updated_at=clock_timestamp();
 end if;
 return public.read_chat_message_reactions(p_actor,p_room,p_conversation,array[p_message]);
end $$;
