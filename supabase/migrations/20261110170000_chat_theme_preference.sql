-- #407: the chat theme follows the member's account, so a new device or browser shows it after
-- sign-in. One nullable column on the existing per-account chat preferences; null means "not chosen
-- on any device yet" (the device's own choice is used, and saved here on the member's first change).
-- Written only by /api/chat/theme with the service role, for the signed-in account itself; the table
-- already has row level security on and no access for anon or authenticated.
alter table public.chat_activity_preferences
  add column theme text
  constraint chat_activity_preferences_theme_check check (theme in ('dark','light','blade-runner','terminal'));
comment on column public.chat_activity_preferences.theme is
  'Chat theme chosen by the member (#407); null until first chosen. Read and written by /api/chat/theme.';
