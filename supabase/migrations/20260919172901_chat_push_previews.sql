-- Disclosure is explicitly chosen per device, never inherited from another device.
alter table public.chat_push_subscriptions add column preview_mode text not null default 'off' check(preview_mode in ('off','sender','message'));
create function public.set_chat_push_preview(actor uuid,p_endpoint text,p_preview text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_preview is null or p_preview not in ('off','sender','message') then raise exception 'invalid_preview';end if;
 update public.chat_push_subscriptions set preview_mode=p_preview,updated_at=now() where account_id=actor and endpoint=p_endpoint;
 return found;
end $$;
-- Claiming does not snapshot private content. Recheck the live source, permissions,
-- unread state, blocks and device preference directly before encryption/delivery.
create function public.prepare_chat_push_job(job_id uuid,worker uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.chat_push_jobs;s public.chat_push_subscriptions;destination text;sender text;message text;attachments boolean;result jsonb;
begin
 select * into j from public.chat_push_jobs where id=job_id and lease_token=worker and lease_until>now() and completed_at is null and created_at>now()-interval '5 minutes';
 if j.id is null then return null;end if;
 select * into s from public.chat_push_subscriptions where id=j.subscription_id;
 if s.id is null then return null;end if;
 destination:=public.chat_push_target(j.kind,j.source_id,s.account_id);
 if destination is null then return null;end if;
 result:=jsonb_build_object('url',destination,'kind',j.kind,'preview',s.preview_mode,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)));
 if s.preview_mode='off' then return result;end if;
 if j.kind='dm' then
  select left(m.display_name,100),case when s.preview_mode='message' then left(d.body,600) end,cardinality(d.attachment_ids)>0 into sender,message,attachments
  from public.longboard_chat_direct_messages d join public.longboard_chat_members m on m.id=d.sender_id where d.id=j.source_id and d.deleted_at is null;
 else
  select left(coalesce(m.display_name,d.author_label),100),case when s.preview_mode='message' then left(d.body,600) end,cardinality(d.attachment_ids)>0 into sender,message,attachments
  from public.chat_room_mentions n join public.longboard_chat_messages d on d.id=n.message_id left join public.longboard_chat_members m on m.id=d.member_id where n.id=j.source_id and n.account_id=s.account_id;
 end if;
 if not found then return null;end if;
 result:=result||jsonb_build_object('sender',sender);
 if s.preview_mode='message' then result:=result||jsonb_build_object('body',message,'hasAttachments',coalesce(attachments,false));end if;
 return result;
end $$;
revoke all on function public.set_chat_push_preview(uuid,text,text),public.prepare_chat_push_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_chat_push_preview(uuid,text,text),public.prepare_chat_push_job(uuid,uuid) to service_role;
