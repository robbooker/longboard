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
create function public.reserve_chat_attachment(sender uuid,room text,name text,mime text,bytes integer) returns public.chat_attachments language plpgsql security invoker set search_path='' as $$
declare result public.chat_attachments; file_id uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('chat-files:'||sender::text,0));
 if (select count(*) from public.chat_attachments where member_id=sender and created_at>now()-interval '1 day')>=100 then raise exception 'attachment_rate_limited'; end if;
 insert into public.chat_attachments(id,member_id,room_slug,filename,mime_type,byte_size,upload_path)
 values(file_id,sender,room,name,mime,bytes,'quarantine/'||file_id::text) returning * into result;
 return result;
end $$;
revoke all on function public.reserve_chat_attachment(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_chat_attachment(uuid,text,text,text,integer) to service_role;
