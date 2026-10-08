-- Liz <-> Rob "Make clearer": sender-only originals and review notes for DMs sent after a review.
-- The DM row (readable by both participants and broadcast over realtime) only ever holds the
-- approved final text. This table is server-only: RLS on with no policies, no client grants,
-- and not part of the realtime publication. Routes return rows to their sender only.
create table public.chat_clarity_drafts (
  message_id uuid primary key references public.longboard_chat_direct_messages(id) on delete cascade,
  conversation_id uuid not null references public.longboard_chat_conversations(id) on delete cascade,
  sender_member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
  original_body text not null check (char_length(original_body) between 1 and 2000),
  suggested_body text check (char_length(suggested_body) <= 4000),
  final_body text not null check (char_length(final_body) <= 2000),
  intent text check (char_length(intent) <= 2000),
  why_changed text check (char_length(why_changed) <= 2000),
  ambiguity_note text check (char_length(ambiguity_note) <= 2000),
  used_suggestion boolean not null,
  standards_sha256 text not null check (standards_sha256 ~ '^[0-9a-f]{64}$'),
  model text not null,
  created_at timestamptz not null default now()
);
create index chat_clarity_drafts_sender_idx on public.chat_clarity_drafts(conversation_id, sender_member_id, created_at desc);
alter table public.chat_clarity_drafts enable row level security;
revoke all on public.chat_clarity_drafts from public, anon, authenticated;
grant all on public.chat_clarity_drafts to service_role;

-- DMs are deleted by setting deleted_at; the private original goes with the message.
create function public.delete_chat_clarity_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chat_clarity_drafts where message_id = new.id;
  return new;
end $$;
revoke all on function public.delete_chat_clarity_draft() from public, anon, authenticated;
create trigger chat_clarity_draft_follows_dm_delete
  after update of deleted_at on public.longboard_chat_direct_messages
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.delete_chat_clarity_draft();
