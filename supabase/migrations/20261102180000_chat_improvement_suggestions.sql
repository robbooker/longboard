-- #352: "Suggest an Improvement" in the What's New room. The same path as #332's "Suggest a topic":
-- the route verifies the member, this function posts one message to the private Admins room.
-- It doesn't reuse post_chat_faq_suggestion, because that one says "suggested an FAQ topic", keeps one
-- line of text and puts every suggestion on Marketing HQ's FAQ review queue for the AI to draft.
--
--  * post_chat_improvement_suggestion(member, text): called by /api/chat/improvement-suggestions with
--    the service role. Posts to 'admins' from bot 'chat-improvements' (labelled "Chat Improvements").
--    The name is read from the members table and the time is the database's, never the caller's. A
--    bot post has no member, so it raises no mentions or push; admins see the room's unread count.
--    Writing here gives the member no read access: the room's rules don't look at this table.
--  * chat_improvement_suggestions: who suggested what, which is also the rate limit, checked under a
--    per-member lock: 1 a minute and 5 a day. Service role only.
--
-- Existing constraint changed: longboard_chat_messages_actor_check, adding this bot in this room only.
-- Without this migration the app still runs: the button shows and sending says it is unavailable.
-- Rollback: supabase/rollbacks/20261102180000_chat_improvement_suggestions.down.sql

create table public.chat_improvement_suggestions(
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null,
 suggestion text not null check(char_length(btrim(suggestion)) between 1 and 450),
 suggested_by uuid references public.longboard_chat_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index chat_improvement_suggestions_member on public.chat_improvement_suggestions(suggested_by,created_at desc) where suggested_by is not null;
alter table public.chat_improvement_suggestions enable row level security;
revoke all on public.chat_improvement_suggestions from public,anon,authenticated,service_role;
grant select,insert on public.chat_improvement_suggestions to service_role;

alter table public.longboard_chat_messages drop constraint longboard_chat_messages_actor_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_actor_check check (
 (guest_id is not null and bot_slug is null) or (guest_id is null and bot_slug='buddy') or
 (room_slug='gainers' and guest_id is null and member_id is null and bot_slug='gainers') or
 (room_slug='whats-new' and guest_id is null and member_id is null and bot_slug='whats-new') or
 (room_slug='admins' and guest_id is null and member_id is null and bot_slug in ('faq-suggestions','chat-improvements'))
);

create function public.post_chat_improvement_suggestion(p_member uuid,p_text text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare note_id uuid:=gen_random_uuid(); who text; clean text:=btrim(coalesce(p_text,''),E' \t\r\n');
begin
 if char_length(clean) not between 1 and 450 then raise exception 'invalid_improvement_suggestion'; end if;
 select m.display_name into who from public.longboard_chat_members m where m.id=p_member;
 if who is null then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_improvement_suggestions:'||p_member::text,0));
 if exists(select 1 from public.chat_improvement_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 minute')
  or (select count(*) from public.chat_improvement_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 day')>=5
 then raise exception 'improvement_suggestion_rate_limited'; end if;
 insert into public.chat_improvement_suggestions(message_id,suggestion,suggested_by) values(note_id,clean,p_member);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'admins','Chat Improvements',who||' suggested a chat improvement from the Suggest an Improvement button in What''s New: '||clean,'chat-improvements');
 return jsonb_build_object('messageId',note_id,'posted',true);
end $$;
revoke all on function public.post_chat_improvement_suggestion(uuid,text) from public,anon,authenticated;
grant execute on function public.post_chat_improvement_suggestion(uuid,text) to service_role;
