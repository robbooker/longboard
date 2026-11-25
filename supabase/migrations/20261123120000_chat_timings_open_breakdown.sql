-- CHAT-TIMING open breakdown (#495, follow-up to #490). A slow open_first_message now comes with
-- two more rows from the same page open, so the dashboard can say why it was slow:
--  * open_ably_connect: ms from the page being shown to the realtime (Ably) connection coming up.
--  * open_catchup: ms from the page being shown to the room's first catch-up
--    (chat_room_events_after, via /api/chat/events) finishing.
-- Same shape as every other row (metric, value, room, device, stream, back); no new column.
-- Only the metric check changes: the six existing names plus the two new ones.
alter table public.chat_timings drop constraint chat_timings_metric_check;
alter table public.chat_timings add constraint chat_timings_metric_check check (metric in (
 'open_first_message','room_switch','send_visible','delivery_lag','tap_response','wrong_landing',
 'open_ably_connect','open_catchup'
));
