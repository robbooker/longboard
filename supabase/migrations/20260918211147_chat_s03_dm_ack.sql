-- Keep legacy send RPCs intact; new clients receive the canonical message in
-- the same transaction as the existing authorization, pair locks and scan gate.
create function public.send_chat_dm_ack(p_user_id uuid,p_action text,p_target uuid,p_body text,p_client_id uuid,p_files uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; result jsonb; message public.longboard_chat_direct_messages;
begin
 if p_action not in ('request','send') or p_action is null or p_client_id is null or p_files is null then raise exception 'invalid_message'; end if;
 if cardinality(p_files)>0 and p_action<>'send' then raise exception 'invalid_attachments'; end if;
 select id into actor from public.longboard_chat_members where user_id=p_user_id;
 if actor is null or not public.chat_account_has_room(p_user_id,'social') then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-dm-actor:'||actor::text,0));
 if cardinality(p_files)>0 then
  result:=public.longboard_chat_dm_media_send(p_user_id,p_action,p_target,p_body,p_client_id,p_files,null);
 else
  result:=public.longboard_chat_dm_action(p_user_id,p_action,p_target,p_body,p_client_id,null);
 end if;
 select * into message from public.longboard_chat_direct_messages where sender_id=actor and client_id=p_client_id;
 -- An introductory request can discover an existing conversation without
 -- inserting a second request. No invented acknowledgement in that case.
 if not found then return result||jsonb_build_object('message',null); end if;
 if message.conversation_id is distinct from (result->>'conversationId')::uuid then raise exception 'invalid_client_id'; end if;
 if message.deleted_at is null and message.edited_at is null and
   (message.body is distinct from btrim(p_body) or message.attachment_ids is distinct from p_files) then raise exception 'invalid_client_id'; end if;
 return result||jsonb_build_object('message',jsonb_build_object(
  'id',message.id,'seq',message.seq,'sender_id',message.sender_id,'client_id',message.client_id,
  'body',message.body,'created_at',message.created_at,'edited_at',message.edited_at,
  'deleted_at',message.deleted_at,'revision',message.revision,'attachment_ids',message.attachment_ids));
end $$;
revoke all on function public.send_chat_dm_ack(uuid,text,uuid,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.send_chat_dm_ack(uuid,text,uuid,text,uuid,uuid[]) to service_role;
