-- #464: Paper Terminal, a fifth chat theme (Terminal's light, daytime twin). The account's saved
-- theme (#407) may now be 'paper-terminal' too. Until this runs, saving that choice to the account
-- is refused (the page still shows it and keeps it on the device); afterwards it saves like the rest.
alter table public.chat_activity_preferences
  drop constraint if exists chat_activity_preferences_theme_check;
alter table public.chat_activity_preferences
  add constraint chat_activity_preferences_theme_check
  check (theme in ('dark','light','blade-runner','terminal','paper-terminal'));
