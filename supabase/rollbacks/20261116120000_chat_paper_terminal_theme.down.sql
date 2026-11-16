-- Rollback for 20261116120000_chat_paper_terminal_theme.sql (#464). Puts back the four-theme check.
-- Accounts that saved Paper Terminal go back to Terminal first (its dark twin), or the old check
-- can't be added. Roll the app back first, so nobody picks Paper Terminal in between.
update public.chat_activity_preferences set theme = 'terminal' where theme = 'paper-terminal';
alter table public.chat_activity_preferences
  drop constraint if exists chat_activity_preferences_theme_check;
alter table public.chat_activity_preferences
  add constraint chat_activity_preferences_theme_check
  check (theme in ('dark','light','blade-runner','terminal'));
