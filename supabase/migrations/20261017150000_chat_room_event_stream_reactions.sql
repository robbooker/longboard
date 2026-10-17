-- EVENT-STREAM step 3 (docs/chat-event-stream.md): reactions and room pause/reopen join the room's
-- numbered sequence, so a window that is in step can keep a room's reactions and its open/paused
-- state current from the stream instead of re-reading them every 30 and 60 seconds. Also
-- CHAT-TIMING's stream tag: each timing says whether the event stream was on for it.
--
--  * longboard_chat_room_reaction_events: one row per room message whose reactions changed, with
--    the number of its latest reaction change. Every reaction set or cleared on a room message
--    (member reactions in chat_message_reaction_choices, guest likes in longboard_chat_reactions)
--    takes the room's next number in the writing transaction, as message and pin changes do. An
--    upsert that changes nothing (the same choice again) keeps its number. Rows are kept 7 days
--    (a window never keeps a cursor longer than a day). DM reactions are not numbered (step 4).
--  * longboard_chat_room_event_heads.state_seq: the number of the room's latest pause/reopen
--    (longboard_chat_room_state: is_open, paused_at or pause_reason changed).
--  * chat_room_events_after(room, after, limit): the same answer as before plus `state` (the latest
--    pause/reopen number, 0 when none; its presence tells the window both are numbered) and
--    `reactions` (each message whose reactions changed after `after`, with its latest number).
--    Old windows ignore both.
--  * chat_timings.stream: 'on' | 'off' (null for batches from before this change), written by
--    record_chat_timings from each row's optional `s`; chat_timings_daily_by_stream splits the
--    daily stats by it. chat_timings_daily is unchanged (the dashboard's Chat speed page).
--
-- Lock order. Reaction writers already lock the room state (for share) and the message (for
-- update) before they write, and the number is taken last, in an AFTER trigger. A pause/reopen
-- holds its room-state row (no key update, which never blocks the key-share lock every message
-- insert takes on it) and then takes the number, like any other numbered change.
--
-- Additive and safe at any time: one new table, two nullable columns (metadata-only), three
-- triggers, two replaced function bodies with the same signatures and one new function. Before it
-- runs the app sees no `state` in a catch-up and keeps the reactions and room status readers on
-- their own timers; timing rows carry `s`, which the old record_chat_timings ignores.
-- Rollback: supabase/rollbacks/20261017150000_chat_room_event_stream_reactions.down.sql.
create table public.longboard_chat_room_reaction_events (
 message_id uuid primary key,
 room_slug text not null,
 event_seq bigint not null,
 updated_at timestamptz not null default now()
);
create index longboard_chat_room_reaction_events_room_seq on public.longboard_chat_room_reaction_events(room_slug, event_seq);
create index longboard_chat_room_reaction_events_updated_at on public.longboard_chat_room_reaction_events(updated_at);
-- Server only: RLS on with no policies, and no table rights for browser roles.
alter table public.longboard_chat_room_reaction_events enable row level security;
revoke all on public.longboard_chat_room_reaction_events from public, anon, authenticated;
grant all on public.longboard_chat_room_reaction_events to service_role;

alter table public.longboard_chat_room_event_heads add column state_seq bigint;

-- TG_ARGV[0]: the column naming the room message (room_message_id or message_id).
create function public.stamp_chat_room_reaction_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 changed jsonb := to_jsonb(case when TG_OP = 'DELETE' then old else new end);
 message uuid := (changed ->> TG_ARGV[0])::uuid;
 slug text;
 next_seq bigint;
begin
 -- A DM reaction, or an upsert that changed nothing a reader sees.
 if message is null then return null; end if;
 if TG_OP = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then return null; end if;
 -- Gone: the message itself is being deleted, and its own change is numbered.
 select m.room_slug into slug from public.longboard_chat_messages m where m.id = message;
 if slug is null then return null; end if;
 insert into public.longboard_chat_room_event_heads as h (room_slug, seq) values (slug, 1)
 on conflict (room_slug) do update set seq = h.seq + 1, updated_at = now()
 returning h.seq into next_seq;
 insert into public.longboard_chat_room_reaction_events as r (message_id, room_slug, event_seq, updated_at)
 values (message, slug, next_seq, now())
 on conflict (message_id) do update set room_slug = excluded.room_slug, event_seq = excluded.event_seq, updated_at = excluded.updated_at;
 delete from public.longboard_chat_room_reaction_events where updated_at < now() - interval '7 days';
 return null;
end $$;
revoke all on function public.stamp_chat_room_reaction_event() from public, anon, authenticated;
-- "zz_" so they run after the foreign key checks (AFTER triggers run in name order).
create trigger zz_chat_room_reaction_event after insert or update or delete on public.chat_message_reaction_choices
 for each row execute function public.stamp_chat_room_reaction_event('room_message_id');
create trigger zz_chat_room_reaction_event after insert or update or delete on public.longboard_chat_reactions
 for each row execute function public.stamp_chat_room_reaction_event('message_id');

create function public.stamp_chat_room_state_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (old.is_open, old.paused_at, old.pause_reason) is not distinct from (new.is_open, new.paused_at, new.pause_reason)
  or new.room_slug is null then
  return null;
 end if;
 insert into public.longboard_chat_room_event_heads as h (room_slug, seq, state_seq) values (new.room_slug, 1, 1)
 on conflict (room_slug) do update set seq = h.seq + 1, state_seq = h.seq + 1, updated_at = now();
 return null;
end $$;
revoke all on function public.stamp_chat_room_state_event() from public, anon, authenticated;
create trigger zz_chat_room_state_event after update on public.longboard_chat_room_state
 for each row execute function public.stamp_chat_room_state_event();

create or replace function public.chat_room_events_after(p_room text, p_after bigint, p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'head', coalesce(h.seq, 0),
  'pins', coalesce(h.pins_seq, 0),
  'state', coalesce(h.state_seq, 0),
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
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) t), '[]'::jsonb),
  'reactions', coalesce((
   select jsonb_agg(jsonb_build_object('id', e.message_id, 'event_seq', e.event_seq) order by e.event_seq) from (
    select x.message_id, x.event_seq from public.longboard_chat_room_reaction_events x
    where x.room_slug = p_room and x.event_seq > p_after
    order by x.event_seq limit least(greatest(p_limit, 1), 500) + 1) e), '[]'::jsonb)
 )
 from (select 1) one
 left join public.longboard_chat_room_event_heads h on h.room_slug = p_room;
$$;
revoke all on function public.chat_room_events_after(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.chat_room_events_after(text, bigint, integer) to service_role;

-- CHAT-TIMING stream tag. A session state, never an identity: 'on' while the room's numbered
-- events were in step for that sample, 'off' otherwise.
alter table public.chat_timings add column stream text check (stream in ('on', 'off'));

create or replace function public.record_chat_timings(p_device text, p_rows jsonb) returns integer
language sql security invoker set search_path='' as $$
 with inserted as (
  insert into public.chat_timings(metric,value,room,device,stream)
  select r.m, r.v, r.r, p_device, case when r.s in ('on','off') then r.s end
  from (select * from jsonb_to_recordset(case when jsonb_typeof(p_rows)='array' and jsonb_array_length(p_rows)<=60 then p_rows else '[]'::jsonb end) as x(m text, v integer, r text, s text)) r
  returning 1)
 select count(*)::integer from inserted;
$$;
revoke all on function public.record_chat_timings(text,jsonb) from public,anon,authenticated;
grant execute on function public.record_chat_timings(text,jsonb) to service_role;

-- chat_timings_daily split by stream ('on', 'off', or null for untagged samples).
create function public.chat_timings_daily_by_stream(p_days integer default 30)
returns table(day date, metric text, device text, stream text, samples bigint, median double precision, p95 double precision, wrong_share double precision)
language sql stable security invoker set search_path='' as $$
 select (t.created_at at time zone 'America/Chicago')::date as day, t.metric, t.device, t.stream, count(*) as samples,
  percentile_cont(0.5) within group (order by t.value) as median,
  percentile_cont(0.95) within group (order by t.value) as p95,
  avg((t.value > 0)::int)::double precision as wrong_share
 from public.chat_timings t
 where t.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days,30),1),30))
 group by 1, 2, 3, 4
 order by 1, 2, 3, 4;
$$;
revoke all on function public.chat_timings_daily_by_stream(integer) from public,anon,authenticated;
grant execute on function public.chat_timings_daily_by_stream(integer) to service_role;
