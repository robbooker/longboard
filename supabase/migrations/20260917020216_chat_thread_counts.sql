-- Backend-only aggregate; the API checks the requesting account's room access.
create or replace function public.chat_thread_counts(p_room text, p_ids uuid[])
returns table(message_id uuid, reply_count bigint)
language sql stable security invoker set search_path=public
as $$
 select p.id, count(r.id)
 from public.longboard_chat_messages p
 left join public.longboard_chat_messages r on r.reply_to_id=p.id and r.room_slug=p_room
 where p.room_slug=p_room and p.id=any(p_ids)
 group by p.id;
$$;
revoke all on function public.chat_thread_counts(text,uuid[]) from public,anon,authenticated;
grant execute on function public.chat_thread_counts(text,uuid[]) to service_role;
