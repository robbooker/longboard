-- EVENT-STREAM step 1 (docs/chat-event-stream.md): every change to a room message gets the
-- room's next number, so a window that missed a live event can ask for "everything after N"
-- instead of re-reading the room history every minute.
--
--  * longboard_chat_room_event_heads: one row per room, the last number handed out. The row
--    is locked from the change until its transaction commits, so numbers commit in order
--    within a room (writers in one room queue for a moment; rooms never wait on each other).
--  * longboard_chat_messages.event_seq: the number of the row's latest change. Set by a BEFORE
--    trigger that runs after every other BEFORE trigger, so `insert/update ... returning *`
--    (and so every row the app publishes) carries it. An update that changes nothing a reader
--    sees (only search_document) keeps the old number.
--  * longboard_chat_room_event_tombstones: hard deletes (a message with no replies), with the
--    number of the delete; kept 7 days (a window never keeps a cursor longer than a day).
--  * chat_room_events_after(room, after, limit): the room's head plus the current state of every
--    row changed after `after`, read in one snapshot. Server only (GET /api/chat/events).
--
-- Additive and safe at any time: no backfill (older rows keep event_seq null, which no reader
-- needs), no table rewrite, and the app ignores all of it until CHAT_EVENT_STREAM is turned on.
-- Rollback: supabase/rollbacks/20261017130000_chat_room_event_stream.down.sql.
create table public.longboard_chat_room_event_heads (
 room_slug text primary key,
 seq bigint not null check (seq > 0),
 updated_at timestamptz not null default now()
);
create table public.longboard_chat_room_event_tombstones (
 room_slug text not null,
 event_seq bigint not null,
 message_id uuid not null,
 deleted_at timestamptz not null default now(),
 primary key (room_slug, event_seq)
);
create index longboard_chat_room_event_tombstones_deleted_at on public.longboard_chat_room_event_tombstones(deleted_at);
-- Server only: RLS on with no policies, and no table rights for browser roles.
alter table public.longboard_chat_room_event_heads enable row level security;
alter table public.longboard_chat_room_event_tombstones enable row level security;
revoke all on public.longboard_chat_room_event_heads, public.longboard_chat_room_event_tombstones from public, anon, authenticated;
grant all on public.longboard_chat_room_event_heads, public.longboard_chat_room_event_tombstones to service_role;

-- Nullable, no default: a metadata-only change.
alter table public.longboard_chat_messages add column event_seq bigint;
create index longboard_chat_messages_room_event_seq on public.longboard_chat_messages(room_slug, event_seq) where event_seq is not null;

create function public.stamp_chat_room_event() returns trigger
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

-- "zz_" so it runs after every other BEFORE trigger on the table (they run in name order) and
-- numbers the row as it is finally written.
create trigger zz_chat_room_event_seq before insert or update on public.longboard_chat_messages
 for each row execute function public.stamp_chat_room_event();
create trigger zz_chat_room_event_tombstone after delete on public.longboard_chat_messages
 for each row execute function public.stamp_chat_room_event();

-- One statement, so the head and the rows come from the same snapshot. Display columns only
-- (the same ones the app publishes to the room's Ably channel; never client_id, guest_id or
-- search_document). At most p_limit rows plus one, so the caller can tell the list was cut.
create function public.chat_room_events_after(p_room text, p_after bigint, p_limit integer default 100)
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
