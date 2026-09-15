-- Keep every existing message and old-client write in Main.
alter table public.longboard_chat_room_state
  drop constraint longboard_chat_room_state_id_check,
  add column room_slug text not null default 'main' unique,
  add constraint longboard_chat_room_slug_check check (room_slug in ('main', 'social'));
insert into public.longboard_chat_room_state(id, room_slug) values (2, 'social');

alter table public.longboard_chat_messages
  add column room_slug text not null default 'main'
  references public.longboard_chat_room_state(room_slug);
create index longboard_chat_messages_room_created_idx
  on public.longboard_chat_messages(room_slug, created_at desc);

alter table public.longboard_chat_summaries
  add column room_slug text not null default 'main' references public.longboard_chat_room_state(room_slug),
  drop constraint longboard_chat_summaries_summary_date_key,
  add constraint longboard_chat_summaries_room_date_key unique(room_slug, summary_date);
alter table public.longboard_chat_admin_events
  add column room_slug text not null default 'main' references public.longboard_chat_room_state(room_slug);

-- Names/identity are shared and must remain available when either room is paused.
drop trigger longboard_chat_guests_require_open on public.longboard_chat_guests;
create or replace function public.enforce_longboard_chat_open()
returns trigger language plpgsql security invoker set search_path = public as $$
declare target_room text;
begin
  if tg_table_name = 'longboard_chat_messages' then
    target_room := new.room_slug;
    if tg_op = 'UPDATE' and new.room_slug <> old.room_slug then
      raise exception 'longboard_chat_room_immutable' using errcode = 'P0001';
    end if;
  else
    select room_slug into target_room from public.longboard_chat_messages where id = new.message_id;
  end if;
  if not exists (select 1 from public.longboard_chat_room_state where room_slug = target_room and is_open) then
    raise exception 'longboard_chat_paused' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
