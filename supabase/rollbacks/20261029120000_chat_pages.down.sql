-- Rollback for 20261029120000_chat_pages.sql (#321 Pages).
-- Removes the Pages tables with every page, shared link and private link in them. Nothing else
-- references these tables.
drop table if exists public.chat_private_links;
drop table if exists public.chat_page_links;
drop function if exists public.enforce_chat_page_link_page();
drop table if exists public.chat_pages;
