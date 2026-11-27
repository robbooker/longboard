-- Rollback for 20261126130000_chat_video_picks.sql (#529 Booker Tube).
-- Removes the page from the sidebar, the four tables (and so every channel, topic and stored video)
-- and the function, and puts the Pages kind check back as it was. Members' own "watched" and
-- "not for me" marks live only in their browsers and are not touched.
-- Run this BEFORE rolling the code back: older code shows an unknown page kind as a list of links.
delete from public.chat_pages where kind='video-picks';
drop index if exists public.chat_pages_one_video_picks;
alter table public.chat_pages drop constraint if exists chat_pages_kind_check;
alter table public.chat_pages add constraint chat_pages_kind_check check(kind in ('embed','links','my-links'));
drop function if exists public.store_chat_video_refresh(uuid,jsonb,jsonb);
drop table if exists public.chat_video_picks;
drop table if exists public.chat_video_topics;
drop table if exists public.chat_video_channels;
drop table if exists public.chat_video_collections;
