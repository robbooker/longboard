-- Rollback for 20261017140000_chat_room_event_stream_pins.sql: back to the step 1 functions.
-- Safe at any time and with the stream on: windows then see no `pins` in a catch-up and put the
-- pins reader back on its own timer.
begin;
drop trigger if exists zz_chat_room_pin_event on public.chat_room_message_pins;
drop function if exists public.stamp_chat_room_pin_event();

create or replace function public.stamp_chat_room_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 next_seq bigint;
 slug text := case when TG_OP = 'DELETE' then old.room_slug else new.room_slug end;
begin
 if TG_OP = 'UPDATE' and (to_jsonb(new) - 'event_seq' - 'search_document') = (to_jsonb(old) - 'event_seq' - 'search_document') then
  new.event_seq := old.event_seq;
  return new;
 end if;
 insert into public.longboard_chat_room_event_heads as h (room_slug, seq) values (slug, 1)
 on conflict (room_slug) do update set seq = h.seq + 1, updated_at = now()
 returning h.seq into next_seq;
 if TG_OP = 'DELETE' then
  insert into public.longboard_chat_room_event_tombstones (room_slug, event_seq, message_id) values (slug, next_seq, old.id);
  delete from public.longboard_chat_room_event_tombstones where deleted_at < now() - interval '7 days';
  return old;
 end if;
 new.event_seq := next_seq;
 return new;
end $$;
revoke all on function public.stamp_chat_room_event() from public, anon, authenticated;

create or replace function public.chat_room_events_after(p_room text, p_after bigint, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'head', coalesce((select h.seq from public.longboard_chat_room_event_heads h where h.room_slug = p_room), 0),
  'rows', coalesce((
   select jsonb_agg(r.row order by r.seq) from (
    select m.event_seq as seq, jsonb_build_object(
     'id', m.id, 'room_slug', m.room_slug, 'member_id', m.member_id, 'author_label', m.author_label,
     'body', m.body, 'bot_slug', m.bot_slug, 'reply_to_id', m.reply_to_id, 'created_at', m.created_at,
     'edited_at', m.edited_at, 'deleted_at', m.deleted_at, 'removed', m.removed, 'revision', m.revision,
     'attachment_ids', m.attachment_ids, 'buddy_status', m.buddy_status, 'unread_seq', m.unread_seq,
     'event_seq', m.event_seq) as row
    from public.longboard_chat_messages m
    where m.room_slug = p_room and m.event_seq > p_after
    order by m.event_seq limit least(greatest(p_limit, 1), 500) + 1) r), '[]'::jsonb),
  'deleted', coalesce((
   select jsonb_agg(jsonb_build_object('id', t.message_id, 'event_seq', t.event_seq) order by t.event_seq) from (
    select x.message_id, x.event_seq from public.longboard_chat_room_event_tombstones x
    where x.room_slug = p_room and x.event_seq > p_after
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) t), '[]'::jsonb)
 );
$$;
revoke all on function public.chat_room_events_after(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.chat_room_events_after(text, bigint, integer) to service_role;

alter table public.longboard_chat_room_event_tombstones drop column if exists reply_to_id;
alter table public.longboard_chat_room_event_heads drop column if exists pins_seq;
commit;
