-- In-app notifications are private and committed with the event that created them.
create table public.chat_feature_notification_preferences (
 account_id uuid primary key references public.chat_feature_members(account_id) on delete cascade,
 requests boolean not null default true, replies boolean not null default true,
 mentions boolean not null default true, assistant boolean not null default true, status boolean not null default true
);
create table public.chat_feature_notification_mutes (
 account_id uuid not null references public.chat_feature_members(account_id) on delete cascade,
 request_id uuid not null references public.chat_feature_requests(id) on delete cascade,
 primary key(account_id,request_id)
);
create table public.chat_feature_notifications (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.chat_feature_members(account_id) on delete cascade,
 request_id uuid not null references public.chat_feature_requests(id) on delete cascade,
 event_key text not null, category text not null check(category in ('requests','replies','mentions','assistant','status')),
 label text not null, request_title text not null, important boolean not null default false,
 created_at timestamptz not null default now(), read_at timestamptz,
 unique(account_id,event_key)
);
create index chat_feature_notifications_inbox on public.chat_feature_notifications(account_id,created_at desc,id);
create index chat_feature_notifications_unread on public.chat_feature_notifications(account_id) where read_at is null;
alter table public.chat_feature_notification_preferences enable row level security;
alter table public.chat_feature_notification_mutes enable row level security;
alter table public.chat_feature_notifications enable row level security;
revoke all on public.chat_feature_notification_preferences,public.chat_feature_notification_mutes,public.chat_feature_notifications from public,anon,authenticated;
grant all on public.chat_feature_notification_preferences,public.chat_feature_notification_mutes,public.chat_feature_notifications to service_role;

create function public.emit_chat_feature_notification(recipient uuid, feature uuid, event text, category text, label text, important boolean default false)
returns void language sql security invoker set search_path=public as $$
 insert into chat_feature_notifications(account_id,request_id,event_key,category,label,request_title,important)
 select recipient,feature,event,category,label,(select title from chat_feature_requests where id=feature),important
 from chat_feature_members m left join chat_feature_notification_preferences p on p.account_id=m.account_id
 where m.account_id=recipient
 and not exists(select 1 from chat_feature_notification_mutes muted where muted.account_id=recipient and muted.request_id=feature)
 and coalesce(case category when 'requests' then p.requests when 'replies' then p.replies when 'mentions' then p.mentions when 'assistant' then p.assistant when 'status' then p.status end,true)
 on conflict(account_id,event_key) do nothing;
$$;
revoke all on function public.emit_chat_feature_notification(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.emit_chat_feature_notification(uuid,uuid,text,text,text,boolean) to service_role;

create function public.chat_feature_request_notifications() returns trigger
language plpgsql security invoker set search_path=public as $$
declare recipient record; event text; label text;
begin
 if TG_OP='INSERT' then
  for recipient in select account_id from chat_feature_members where role='owner' and account_id<>new.created_by loop
   perform emit_chat_feature_notification(recipient.account_id,new.id,'request:'||new.id,'requests','New feature request',false);
  end loop;
 elsif new.status is distinct from old.status then
  label:=case new.status when 'approved' then 'Approved for development' when 'declined' then 'Request declined' when 'in_progress' then 'Development started' when 'blocked' then 'Needs your decision' when 'ready' then 'Ready to test' when 'done' then 'Published and verified' end;
  if label is null then return new; end if;
  event:='status:'||gen_random_uuid();
  for recipient in select account_id,role from chat_feature_members loop
   if (new.status in ('approved','declined') and recipient.role<>'participant') or (new.status='blocked' and recipient.role<>'owner') then continue; end if;
   perform emit_chat_feature_notification(recipient.account_id,new.id,event,'status',label,new.status in ('blocked','ready'));
  end loop;
 end if;
 return new;
end $$;
create trigger chat_feature_request_notifications after insert or update of status on public.chat_feature_requests
for each row execute function public.chat_feature_request_notifications();
revoke all on function public.chat_feature_request_notifications() from public,anon,authenticated;
grant execute on function public.chat_feature_request_notifications() to service_role;

create function public.chat_feature_message_notifications() returns trigger
language plpgsql security invoker set search_path=public as $$
declare recipient record; category text; label text; mentioned boolean;
begin
 -- Status changes have their own alert. Progress-only system messages remain quiet.
 if new.kind='system' then return new; end if;
 for recipient in select account_id,role from chat_feature_members where account_id is distinct from new.author_id loop
  mentioned:=new.kind='human' and new.body ~* case when recipient.role='owner' then '(^|[^[:alnum:]_])@(Rob|Robbie)([^[:alnum:]_]|$)' else '(^|[^[:alnum:]_])@Jammie([^[:alnum:]_]|$)' end;
  category:=case when new.kind='assistant' then 'assistant' when mentioned then 'mentions' else 'replies' end;
  label:=case when new.kind='assistant' then 'Codex replied' when mentioned then new.author_label||' mentioned you' else new.author_label||' replied' end;
  perform emit_chat_feature_notification(recipient.account_id,new.request_id,'message:'||new.id,category,label,false);
 end loop;
 return new;
end $$;
create trigger chat_feature_message_notifications after insert on public.chat_feature_messages
for each row execute function public.chat_feature_message_notifications();
revoke all on function public.chat_feature_message_notifications() from public,anon,authenticated;
grant execute on function public.chat_feature_message_notifications() to service_role;

-- Publishing is still a separate owner decision, never a worker action.
alter table public.chat_feature_requests drop constraint chat_feature_requests_status_check;
alter table public.chat_feature_requests add constraint chat_feature_requests_status_check check(status in ('discussion','approved','in_progress','ready','declined','blocked','done'));
create function public.publish_chat_feature(actor uuid, feature uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from chat_feature_members where account_id=actor and role='owner') then raise exception 'owner_only'; end if;
 update chat_feature_requests set status='done' where id=feature and status='ready';
 if not found then raise exception 'request_not_ready'; end if;
 insert into chat_feature_messages(request_id,author_id,author_label,kind,body) values(feature,actor,'Rob','system','Rob marked this feature as published and verified.');
 return feature;
end $$;
revoke all on function public.publish_chat_feature(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_chat_feature(uuid,uuid) to service_role;
