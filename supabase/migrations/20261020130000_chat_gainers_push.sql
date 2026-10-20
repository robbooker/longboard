-- GAINERS-PUSH: each person can turn on phone notifications for Gainers posts, per device
-- (like previews). Off by default. When on, every new Gainers post queues one job per opted-in
-- device. Gainers posts are public market alerts, so the notification shows the post's first
-- line even when previews are off. Delivery re-checks access, the room's mute level and the
-- device's choice, so turning it off or muting Gainers also stops a queued notification.
-- Rollback: supabase/rollbacks/20261020130000_chat_gainers_push.down.sql
alter table public.chat_push_subscriptions add column gainers boolean not null default false;
alter table public.chat_push_jobs drop constraint chat_push_jobs_kind_check,
 add constraint chat_push_jobs_kind_check check (kind in ('dm','room','gainers'));
create index chat_push_gainers on public.chat_push_subscriptions(id) where gainers;

create function public.set_chat_push_gainers(actor uuid,p_endpoint text,p_gainers boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if p_gainers is null then raise exception 'invalid_gainers';end if;
 update public.chat_push_subscriptions set gainers=p_gainers,updated_at=now() where account_id=actor and endpoint=p_endpoint;
 get diagnostics changed=row_count;return changed=1;
end $$;

-- Only the Gainers bot's posts (ingest_chat_gainers_alert); source_id is the message id.
create function public.queue_chat_gainers_push() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.chat_push_jobs(subscription_id,kind,source_id)
 select s.id,'gainers',new.id from public.chat_push_subscriptions s where s.gainers
  and not exists(select 1 from public.chat_room_notification_levels l where l.account_id=s.account_id and l.room_slug='gainers' and l.level='muted')
 on conflict do nothing;
 return new;
end $$;
create trigger chat_push_gainers after insert on public.longboard_chat_messages
 for each row when (new.room_slug='gainers' and new.bot_slug='gainers') execute function public.queue_chat_gainers_push();

-- As 20261015180000, plus the gainers branch. The device's switch is checked in
-- prepare_chat_push_job (it belongs to the device, not the account).
CREATE OR REPLACE FUNCTION public.chat_push_target(kind text, source uuid, actor uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when kind='dm' then (
  select '/chat?dm='||c.id from public.longboard_chat_direct_messages d
  join public.longboard_chat_conversations c on c.id=d.conversation_id
  join public.longboard_chat_members me on me.user_id=actor and me.id in(c.requester_id,c.recipient_id)
  where d.id=source and d.deleted_at is null and c.status='accepted' and d.sender_id<>me.id
  and public.chat_account_room_recipient_eligible(actor,'social')
  and exists(select 1 from public.longboard_chat_members sender where sender.id=d.sender_id and public.chat_account_room_recipient_eligible(sender.user_id,'social'))
  and d.seq>case when c.requester_id=me.id then c.requester_read_seq else c.recipient_read_seq end
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id=d.sender_id) or (b.blocked_id=me.id and b.blocker_id=d.sender_id))
 ) when kind='gainers' then (
  select '/chat?room=gainers'
  from public.longboard_chat_messages m
  where m.id=source and m.room_slug='gainers' and m.bot_slug='gainers' and m.deleted_at is null and not m.removed
  and public.chat_account_room_recipient_eligible(actor,'gainers')
  and not exists(select 1 from public.chat_room_notification_levels l where l.account_id=actor and l.room_slug='gainers' and l.level='muted')
 ) else (
  select '/chat?room='||n.room_slug||'&thread='||coalesce(n.thread_root_id,m.reply_to_id,m.id)
  from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
  join public.longboard_chat_members me on me.user_id=actor
  left join public.longboard_chat_messages root on root.id=n.thread_root_id
  left join public.chat_activity_preferences p on p.account_id=actor
  where n.id=source and n.account_id=actor and n.read_at is null and m.member_id is distinct from me.id
  and public.chat_account_room_recipient_eligible(actor,n.room_slug) and (n.category<>'reply' or coalesce(p.replies,true))
  -- ROOM-NOTIFY: re-checked just before delivery, so muting stops a queued push too.
  and not exists(select 1 from public.chat_room_notification_levels l where l.account_id=actor and l.room_slug=n.room_slug and l.level='muted')
  and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.id and b.blocked_id in(m.member_id,root.member_id)) or (b.blocked_id=me.id and b.blocker_id in(m.member_id,root.member_id)))
 ) end;
$function$;

-- As 20261002153528, plus: a gainers job needs the device's switch still on, and always carries
-- the post's text (public market data), whatever the device's preview setting.
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
  select left(m.display_name,100),case when s.preview_mode='message' then left(d.body,600) end,cardinality(d.attachment_ids)>0 into sender,message,attachments
  from public.longboard_chat_direct_messages d join public.longboard_chat_members m on m.id=d.sender_id where d.id=j.source_id and d.deleted_at is null;
 else
  select left(coalesce(m.display_name,d.author_label),100),case when s.preview_mode='message' then left(d.body,600) end,cardinality(d.attachment_ids)>0,n.room_slug,n.category into sender,message,attachments,room,category
  from public.chat_room_mentions n join public.longboard_chat_messages d on d.id=n.message_id left join public.longboard_chat_members m on m.id=d.member_id where n.id=j.source_id and n.account_id=s.account_id;
 end if;
 if not found then return null;end if;
 result:=result||jsonb_build_object('sender',sender);
 if j.kind='room' then result:=result||jsonb_build_object('room',room,'category',category);end if;
 if s.preview_mode='message' then result:=result||jsonb_build_object('body',message,'hasAttachments',coalesce(attachments,false));end if;
 return result;
end $$;

revoke all on function public.set_chat_push_gainers(uuid,text,boolean),public.queue_chat_gainers_push(),public.prepare_chat_push_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_chat_push_gainers(uuid,text,boolean),public.queue_chat_gainers_push(),public.prepare_chat_push_job(uuid,uuid) to service_role;
