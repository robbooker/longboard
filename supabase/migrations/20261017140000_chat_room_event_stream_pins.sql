-- EVENT-STREAM step 2 (docs/chat-event-stream.md): pins join the room's numbered sequence, and a
-- hard delete remembers which conversation it left, so a window that is in step can keep its
-- pins, open thread and reply counts current from the stream instead of re-reading them every
-- minute.
--
--  * longboard_chat_room_event_heads.pins_seq: the number of the room's latest pin change. Every
--    pin and unpin (and every pin removed with its message) takes the room's next number, exactly
--    like a message change, in the writing transaction. Lock order is unchanged: pin writers
--    already lock the message row first, as message writers do, and only then take the head.
--  * longboard_chat_room_event_tombstones.reply_to_id: the parent of a hard-deleted reply, so its
--    reply count is the only one a window refreshes.
--  * chat_room_events_after(room, after, limit): the same answer as before plus `pins` (the
--    latest pin change number, 0 when none) and each tombstone's `reply_to_id`. Old windows ignore
--    both.
--
-- Additive and safe at any time: two nullable columns (metadata-only), one new trigger, and two
-- replaced function bodies with the same signatures. Before it runs the app sees no `pins` in a
-- catch-up and keeps the pins reader on its own timer.
-- Rollback: supabase/rollbacks/20261017140000_chat_room_event_stream_pins.down.sql.
alter table public.longboard_chat_room_event_heads add column pins_seq bigint;
alter table public.longboard_chat_room_event_tombstones add column reply_to_id uuid;

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
  insert into public.longboard_chat_room_event_tombstones (room_slug, event_seq, message_id, reply_to_id)
  values (slug, next_seq, old.id, old.reply_to_id);
  delete from public.longboard_chat_room_event_tombstones where deleted_at < now() - interval '7 days';
  return old;
 end if;
 new.event_seq := next_seq;
 return new;
end $$;
revoke all on function public.stamp_chat_room_event() from public, anon, authenticated;

create function public.stamp_chat_room_pin_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 slug text := case when TG_OP = 'DELETE' then old.room_slug else new.room_slug end;
begin
 insert into public.longboard_chat_room_event_heads as h (room_slug, seq, pins_seq) values (slug, 1, 1)
 on conflict (room_slug) do update set seq = h.seq + 1, pins_seq = h.seq + 1, updated_at = now();
 return null;
end $$;
revoke all on function public.stamp_chat_room_pin_event() from public, anon, authenticated;
create trigger zz_chat_room_pin_event after insert or delete on public.chat_room_message_pins
 for each row execute function public.stamp_chat_room_pin_event();

create or replace function public.chat_room_events_after(p_room text, p_after bigint, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'head', coalesce((select h.seq from public.longboard_chat_room_event_heads h where h.room_slug = p_room), 0),
  'pins', coalesce((select h.pins_seq from public.longboard_chat_room_event_heads h where h.room_slug = p_room), 0),
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
   select jsonb_agg(jsonb_build_object('id', t.message_id, 'event_seq', t.event_seq, 'reply_to_id', t.reply_to_id) order by t.event_seq) from (
    select x.message_id, x.event_seq, x.reply_to_id from public.longboard_chat_room_event_tombstones x
    where x.room_slug = p_room and x.event_seq > p_after
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) t), '[]'::jsonb)
 );
$$;
revoke all on function public.chat_room_events_after(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.chat_room_events_after(text, bigint, integer) to service_role;
