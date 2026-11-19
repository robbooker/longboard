-- #465 Phone notifications carry the whole message (the app cuts it to about 1,000 characters
-- and a byte budget in lib/chatPushPreview.ts). As 20261020130000, except the DM and room
-- mention/reply text is read up to 2,000 characters instead of 600, so the app has enough to
-- clean and cut. Gainers stays at 600 (its notification shows one short line). Jobs store only a
-- source id; the text is read here at send time, so nothing else is stored or resized.
create or replace function public.prepare_chat_push_job(job_id uuid,worker uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.chat_push_jobs;s public.chat_push_subscriptions;destination text;sender text;message text;attachments boolean;room text;category text;result jsonb;
begin
 select * into j from public.chat_push_jobs where id=job_id and lease_token=worker and lease_until>now() and completed_at is null and created_at>now()-interval '5 minutes';
 if j.id is null then return null;end if;
 select * into s from public.chat_push_subscriptions where id=j.subscription_id;
 if s.id is null then return null;end if;
 if j.kind='gainers' and not s.gainers then return null;end if;
 destination:=public.chat_push_target(j.kind,j.source_id,s.account_id);
 if destination is null then return null;end if;
 result:=jsonb_build_object('url',destination,'kind',j.kind,'preview',s.preview_mode,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)));
 if j.kind='gainers' then
  select left(d.body,600) into message from public.longboard_chat_messages d where d.id=j.source_id;
  return result||jsonb_build_object('body',message);
 end if;
 if s.preview_mode not in ('sender','message') or s.preview_mode is null then return result;end if;
 if j.kind='dm' then
  select left(m.display_name,100),case when s.preview_mode='message' then left(d.body,2000) end,cardinality(d.attachment_ids)>0 into sender,message,attachments
  from public.longboard_chat_direct_messages d join public.longboard_chat_members m on m.id=d.sender_id where d.id=j.source_id and d.deleted_at is null;
 else
  select left(coalesce(m.display_name,d.author_label),100),case when s.preview_mode='message' then left(d.body,2000) end,cardinality(d.attachment_ids)>0,n.room_slug,n.category into sender,message,attachments,room,category
  from public.chat_room_mentions n join public.longboard_chat_messages d on d.id=n.message_id left join public.longboard_chat_members m on m.id=d.member_id where n.id=j.source_id and n.account_id=s.account_id;
 end if;
 if not found then return null;end if;
 result:=result||jsonb_build_object('sender',sender);
 if j.kind='room' then result:=result||jsonb_build_object('room',room,'category',category);end if;
 if s.preview_mode='message' then result:=result||jsonb_build_object('body',message,'hasAttachments',coalesce(attachments,false));end if;
 return result;
end $$;

revoke all on function public.prepare_chat_push_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_chat_push_job(uuid,uuid) to service_role;
