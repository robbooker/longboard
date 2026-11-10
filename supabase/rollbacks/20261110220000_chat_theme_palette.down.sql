-- Rollback for 20261110220000_chat_theme_palette.sql (#420). Drops the saved colour combinations;
-- each member's theme column still holds the combination's base theme (dark or light), so they see
-- that plain theme. /api/chat/theme treats the missing column as "no combination".
alter table public.chat_activity_preferences drop column if exists palette;
