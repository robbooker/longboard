-- Rollback for 20261110170000_chat_theme_preference.sql (#407). Drops the saved chat theme; every
-- device keeps its own copy, so members see their theme as before. Rows created only to hold a theme
-- stay (their replies setting is the default, the same as having no row).
alter table public.chat_activity_preferences drop column if exists theme;
