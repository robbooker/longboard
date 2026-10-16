-- AVATARS-REST (D-219): a thread link shows "2 replies · last 3 min ago" and the latest
-- repliers' initials. Same single pass over the same join as chat_thread_counts (no extra
-- request, no extra scan): the count, the newest reply time, and the 20 newest visible replies'
-- authors (current chat name, like room rows), newest first. The API keeps the first three
-- distinct people.
-- The app works before and after this runs: /api/chat/thread-counts falls back to
-- chat_thread_counts (counts only) while this function is missing.
-- Backend-only aggregate; the API checks the requesting account's room access.
create or replace function public.chat_thread_summaries(p_room text, p_ids uuid[])
returns table(message_id uuid, reply_count bigint, last_reply_at timestamptz, repliers jsonb)
language sql stable security invoker set search_path=public
as $$
 select p.id, count(r.id), max(r.created_at),
  to_jsonb(coalesce((array_agg(
    jsonb_build_object('member', r.member_id, 'guest', r.guest_id, 'bot', r.bot_slug, 'name', case when r.bot_slug is null then coalesce(n.display_name, r.author_label) else r.author_label end)
    order by r.created_at desc) filter (where r.id is not null and r.deleted_at is null))[1:20], '{}'))
 from public.longboard_chat_messages p
 left join public.longboard_chat_messages r on r.reply_to_id=p.id and r.room_slug=p_room and not r.removed
 left join public.longboard_chat_members n on n.id=r.member_id
 where p.room_slug=p_room and p.id=any(p_ids)
 group by p.id;
$$;
revoke all on function public.chat_thread_summaries(text,uuid[]) from public,anon,authenticated;
grant execute on function public.chat_thread_summaries(text,uuid[]) to service_role;
