create or replace function public.longboard_chat_inbox(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(item order by updated_at desc),'[]'::jsonb) from (
    select c.updated_at, jsonb_build_object(
      'id',c.id, 'status',c.status, 'incoming',c.recipient_id=me.id,
      'otherId',other.id, 'otherName',other.display_name,
      'blockedByMe',exists(select 1 from public.longboard_chat_blocks b where b.blocker_id=me.id and b.blocked_id=other.id),
      'unavailable',exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)),
      'lastBody',(select case when d.body='' and cardinality(d.attachment_ids)>0 then '[Attachment]' else d.body end from public.longboard_chat_direct_messages d where d.conversation_id=c.id order by d.seq desc limit 1),
      'updatedAt',c.updated_at,
      'latestIncomingSeq',case when c.status='declined' or exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.id)) then 0 else coalesce((select max(d.seq) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.deleted_at is null),0) end,
      'unread',case when c.status='declined' then 0 else (select count(*) from public.longboard_chat_direct_messages d where d.conversation_id=c.id and d.sender_id<>me.id and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end) end
    ) as item
    from public.longboard_chat_members me
    join public.longboard_chat_conversations c on c.requester_id=me.id or c.recipient_id=me.id
    join public.longboard_chat_members other on other.id=case when c.requester_id=me.id then c.recipient_id else c.requester_id end
    where me.user_id=p_user_id
  ) conversations;
$$;

revoke all on function public.longboard_chat_inbox(uuid) from public,anon,authenticated;
grant execute on function public.longboard_chat_inbox(uuid) to service_role;
