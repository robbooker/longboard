-- Rollback for 20261108120000_chat_card_layouts.sql (#379 Six view). Members' saved Six layouts
-- are lost; Six falls back to the copy in each browser.
drop table if exists public.chat_card_layouts;
