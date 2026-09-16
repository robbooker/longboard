-- Member reply panels read recent replies within an authorized room.
create index if not exists longboard_chat_message_thread_idx
 on public.longboard_chat_messages(room_slug,reply_to_id,created_at desc)
 where reply_to_id is not null;
