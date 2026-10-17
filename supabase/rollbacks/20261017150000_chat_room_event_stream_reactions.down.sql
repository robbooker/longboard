-- Rollback for 20261017150000_chat_room_event_stream_reactions.sql: back to the step 2 catch-up
-- and the original timing functions. Safe at any time and with the stream on: windows then see no
-- `state` in a catch-up and put the reactions and room status readers back on their own timers;
-- timing rows keep sending `s`, which the restored record_chat_timings ignores.
begin;
drop trigger if exists zz_chat_room_reaction_event on public.chat_message_reaction_choices;
drop trigger if exists zz_chat_room_reaction_event on public.longboard_chat_reactions;
drop trigger if exists zz_chat_room_state_event on public.longboard_chat_room_state;
drop function if exists public.stamp_chat_room_reaction_event();
drop function if exists public.stamp_chat_room_state_event();

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

drop table if exists public.longboard_chat_room_reaction_events;
alter table public.longboard_chat_room_event_heads drop column if exists state_seq;

drop function if exists public.chat_timings_daily_by_stream(integer);
create or replace function public.record_chat_timings(p_device text, p_rows jsonb) returns integer
language sql security invoker set search_path='' as $$
 with inserted as (
  insert into public.chat_timings(metric,value,room,device)
  select r.m, r.v, r.r, p_device
  from (select * from jsonb_to_recordset(case when jsonb_typeof(p_rows)='array' and jsonb_array_length(p_rows)<=60 then p_rows else '[]'::jsonb end) as x(m text, v integer, r text)) r
  returning 1)
 select count(*)::integer from inserted;
$$;
revoke all on function public.record_chat_timings(text,jsonb) from public,anon,authenticated;
grant execute on function public.record_chat_timings(text,jsonb) to service_role;
alter table public.chat_timings drop column if exists stream;
commit;
