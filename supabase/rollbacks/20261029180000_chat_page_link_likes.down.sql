-- Rollback for 20261029180000_chat_page_link_likes.sql (#323 Trader Links likes).
-- Removes every like on shared links and the like summary function. The links themselves, and
-- everything else from #321 Pages, stay.
drop function if exists public.chat_page_link_like_summary(uuid,uuid,uuid);
drop table if exists public.chat_page_link_likes;
drop function if exists public.enforce_chat_page_link_like();
