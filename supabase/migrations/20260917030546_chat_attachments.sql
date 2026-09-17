-- Private quarantine and clean objects. No client storage policies: the server
-- issues scoped upload/download URLs after checking the current chat identity.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-attachments','chat-attachments',false,10000000,array['application/pdf','image/jpeg','image/png','image/gif']);

create table public.chat_attachments (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 room_slug text not null check(room_slug in ('main','social','shortscout')),
 filename text not null check(length(filename) between 1 and 180),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/gif')),
 byte_size integer not null check(byte_size between 1 and 10000000),
 status text not null default 'pending' check(status in ('pending','scanning','ready','rejected','attached')),
 upload_path text not null unique,
 object_path text unique,
 sha256 text,
 scan_token uuid,
 scan_started_at timestamptz,
 room_message_id uuid references public.longboard_chat_messages(id) on delete cascade deferrable initially deferred,
 created_at timestamptz not null default now(),
 check(status not in ('ready','attached') or (object_path is not null and sha256 is not null)),
 check(status <> 'attached' or room_message_id is not null)
);
alter table public.chat_attachments enable row level security;
revoke all on public.chat_attachments from public,anon,authenticated;
grant all on public.chat_attachments to service_role;
create index chat_attachments_member_created on public.chat_attachments(member_id,created_at);
create index chat_attachments_cleanup on public.chat_attachments(created_at) where status <> 'attached';

alter table public.longboard_chat_messages add column attachment_ids uuid[] not null default '{}';

-- Bind clean files to the sender and exact conversation in the same transaction
-- as the message. Concurrent sends cannot share/rebind one attachment.
create function public.bind_chat_attachments() returns trigger language plpgsql security invoker set search_path='' as $$
declare a public.chat_attachments; aid uuid;
begin
 if TG_OP='UPDATE' and new.attachment_ids=old.attachment_ids then return new; end if;
 if TG_OP='UPDATE' and cardinality(old.attachment_ids)>0 then raise exception 'attachments_immutable'; end if;
 if cardinality(new.attachment_ids)>3 or array_position(new.attachment_ids,null) is not null or cardinality(new.attachment_ids)<>(select count(distinct x) from unnest(new.attachment_ids) x) then raise exception 'invalid_attachments'; end if;
 foreach aid in array new.attachment_ids loop
  select * into a from public.chat_attachments where id=aid for update;
  if not found or a.status<>'ready' or a.member_id is distinct from new.member_id then raise exception 'attachment_not_ready'; end if;
  if a.room_slug is distinct from new.room_slug then raise exception 'attachment_wrong_room'; end if;
  update public.chat_attachments set status='attached',room_message_id=new.id where id=aid;
 end loop;
 return new;
end $$;
revoke all on function public.bind_chat_attachments() from public,anon,authenticated;
grant execute on function public.bind_chat_attachments() to service_role;
create trigger bind_room_attachments before insert or update of attachment_ids on public.longboard_chat_messages for each row execute function public.bind_chat_attachments();
-- Keep quota accounting independent from cancelled/deleted draft metadata.
create table public.chat_attachment_daily_usage (
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 day date not null,
 uploads integer not null check(uploads between 0 and 100),
 primary key(member_id,day)
);
alter table public.chat_attachment_daily_usage enable row level security;
revoke all on public.chat_attachment_daily_usage from public,anon,authenticated;
grant all on public.chat_attachment_daily_usage to service_role;
create index chat_attachments_message on public.chat_attachments(room_message_id) where room_message_id is not null;
create function public.reserve_chat_attachment(sender uuid,room text,name text,mime text,bytes integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.chat_attachments; file_id uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('chat-files:'||sender::text,0));
 insert into public.chat_attachment_daily_usage(member_id,day,uploads) values(sender,(now() at time zone 'UTC')::date,0) on conflict do nothing;
 update public.chat_attachment_daily_usage set uploads=uploads+1 where member_id=sender and day=(now() at time zone 'UTC')::date and uploads<100;
 if not found then raise exception 'attachment_rate_limited'; end if;
 insert into public.chat_attachments(id,member_id,room_slug,filename,mime_type,byte_size,upload_path)
 values(file_id,sender,room,name,mime,bytes,'quarantine/'||file_id::text) returning * into result;
 return to_jsonb(result);
end $$;
revoke all on function public.reserve_chat_attachment(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_chat_attachment(uuid,text,text,text,integer) to service_role;

-- Idempotent sends: serialize each sender/client key before the attachment trigger.
alter table public.longboard_chat_messages add column client_id uuid;
create unique index room_message_client_id on public.longboard_chat_messages(member_id,client_id) where client_id is not null;
alter table public.longboard_chat_messages drop constraint longboard_chat_messages_body_check;
alter table public.longboard_chat_messages add constraint longboard_chat_messages_body_check
 check(char_length(btrim(body)) <= 600 and (char_length(btrim(body)) >= 1 or cardinality(attachment_ids)>0));
create function public.send_chat_attachment_message(sender uuid,room text,label text,content text,reply uuid,files uuid[],client uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.longboard_chat_messages;
begin
 if client is null then raise exception 'client_id_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(sender::text||client::text,0));
 select * into result from public.longboard_chat_messages where member_id=sender and client_id=client;
 if found then
  if result.room_slug<>room or result.body<>content or result.reply_to_id is distinct from reply or result.attachment_ids<>files then raise exception 'send_conflict'; end if;
  return to_jsonb(result);
 end if;
 insert into public.longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id,attachment_ids,client_id)
 values(sender,sender,room,label,content,reply,files,client) returning * into result;
 return to_jsonb(result);
end $$;
revoke all on function public.send_chat_attachment_message(uuid,text,text,text,uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.send_chat_attachment_message(uuid,text,text,text,uuid,uuid[],uuid) to service_role;

-- Quarantine upload URLs live for two hours. Do not delete their objects until
-- after expiry, or a still-valid upload URL could recreate an untracked object.
create table public.chat_attachment_deletions (
 path text primary key,
 not_before timestamptz not null default now()
);
alter table public.chat_attachment_deletions enable row level security;
revoke all on public.chat_attachment_deletions from public,anon,authenticated;
grant all on public.chat_attachment_deletions to service_role;
create index chat_attachment_deletions_due on public.chat_attachment_deletions(not_before);
create function public.queue_chat_attachment_cleanup() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  insert into public.chat_attachment_deletions(path,not_before) values(new.upload_path,new.created_at+interval '3 hours') on conflict do nothing;
  return new;
 end if;
 insert into public.chat_attachment_deletions(path,not_before) values(old.upload_path,greatest(now(),old.created_at+interval '3 hours')) on conflict do nothing;
 if old.object_path is not null then
  -- Grace period outlasts an in-flight scanner/promoter before deleting bytes.
  insert into public.chat_attachment_deletions(path,not_before) values(old.object_path,now()+interval '5 minutes') on conflict do nothing;
 end if;
 return old;
end $$;
revoke all on function public.queue_chat_attachment_cleanup() from public,anon,authenticated;
grant execute on function public.queue_chat_attachment_cleanup() to service_role;
create trigger chat_attachment_cleanup_insert after insert on public.chat_attachments for each row execute function public.queue_chat_attachment_cleanup();
create trigger chat_attachment_cleanup_delete after delete on public.chat_attachments for each row execute function public.queue_chat_attachment_cleanup();
