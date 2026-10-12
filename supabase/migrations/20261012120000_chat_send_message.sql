-- P10 + S2: one database call sends a room message. Before this a send waited on the room
-- state, the member, an earlier send with the same clientId, the reply parent, the rate
-- limit, the insert and then the badges, each in turn. The rate limit was a read followed
-- by a separate insert, so a burst could slip past it; it is now checked and recorded under
-- one per-member lock. The insert triggers (paused room, reply parent, attachments, Buddy)
-- still run and still have the final say.
-- send_chat_attachment_message stays for the running app until this deploy is verified.
create function public.send_chat_room_message(p_user uuid,p_room text,p_body text,p_reply uuid,p_files uuid[],p_client uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 room public.longboard_chat_room_state;
 member public.longboard_chat_members;
 result public.longboard_chat_messages;
 recent int;
 latest timestamptz;
 status text:='sent';
 badges jsonb;
begin
 if p_client is null then raise exception 'client_id_required'; end if;
 select * into room from public.longboard_chat_room_state where room_slug=p_room;
 if not found then return jsonb_build_object('status','room_unavailable'); end if;
 if not room.is_open then
  return jsonb_build_object('status','paused','room',jsonb_build_object('isOpen',false,'pausedAt',room.paused_at,
   'notice',nullif(btrim(room.pause_reason),''),'updatedAt',room.updated_at));
 end if;
 select * into member from public.longboard_chat_members where user_id=p_user;
 if not found then return jsonb_build_object('status','member_required'); end if;

 -- Same key as send_chat_attachment_message, so old and new app versions exclude each other.
 perform pg_advisory_xact_lock(hashtextextended(member.id::text||p_client::text,0));
 select * into result from public.longboard_chat_messages where member_id=member.id and client_id=p_client;
 if found then
  -- A retry of a message since edited or deleted is still the same send.
  if result.room_slug<>p_room
   or (result.deleted_at is null and result.edited_at is null and result.body<>p_body)
   or result.reply_to_id is distinct from p_reply
   or (result.deleted_at is null and result.attachment_ids<>p_files)
  then return jsonb_build_object('status','send_conflict'); end if;
  status:='duplicate';
 else
  if p_reply is not null and not exists(select 1 from public.longboard_chat_messages
    where id=p_reply and room_slug=p_room and not removed) then
   return jsonb_build_object('status','reply_not_found');
  end if;
  -- S2: concurrent sends by one member queue here, so each sees the others' inserts.
  perform pg_advisory_xact_lock(hashtextextended('chat_send_rate:'||member.id::text,0));
  select count(*),max(created_at) into recent,latest from (
   select created_at from public.longboard_chat_messages
   where guest_id=member.id and created_at>=clock_timestamp()-interval '10 minutes'
   order by created_at desc limit 30) r;
  if recent>=30 then return jsonb_build_object('status','rate_limited','reason','window'); end if;
  if latest>clock_timestamp()-interval '1.5 seconds' then return jsonb_build_object('status','rate_limited','reason','burst'); end if;
  insert into public.longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,attachment_ids,client_id)
  values(member.id,member.id,p_room,member.display_name,p_body,p_reply,p_files,p_client) returning * into result;
 end if;

 -- Badges as chat_member_membership_sources and the local ShortScout copy give them.
 select jsonb_path_query_array(jsonb_build_array(
   case when s.longboard then 'LB' end,
   case when s.shortscout_subject is not null and exists(select 1 from public.chat_shortscout_paid_subjects(array[s.shortscout_subject])) then 'SS' end),
  '$[*] ? (@ != null)')
 into badges from public.chat_member_membership_sources(array[member.id]) s;
 return jsonb_build_object('status',status,'message',to_jsonb(result)
  ||jsonb_build_object('author_label',member.display_name,'memberships',coalesce(badges,'[]'::jsonb)));
end $$;

revoke all on function public.send_chat_room_message(uuid,text,text,uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.send_chat_room_message(uuid,text,text,uuid,uuid[],uuid) to service_role;
