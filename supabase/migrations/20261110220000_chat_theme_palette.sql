-- #420: a colour combination for the standard chat look ("Ocean", "Paper", ...), kept on the
-- member's account beside their theme so it follows them to other devices. One nullable column on
-- the existing per-account chat preferences; null means a plain theme with no combination.
-- `theme` keeps holding one of the four themes (the combination's base, dark or light), so code
-- from before this column reads and writes it exactly as it did.
-- The check is on the shape of the name only, not a list of names: the list lives in the app
-- (lib/chatTheme.ts), which ignores a name it does not know, so adding or removing a combination
-- needs no migration.
-- Written only by /api/chat/theme with the service role, for the signed-in account itself; the table
-- already has row level security on and no access for anon or authenticated.
alter table public.chat_activity_preferences
  add column if not exists palette text
  constraint chat_activity_preferences_palette_check check (palette ~ '^[a-z0-9-]{1,32}$');
comment on column public.chat_activity_preferences.palette is
  'Colour combination on top of the chat theme (#420); null for a plain theme. Read and written by /api/chat/theme.';
