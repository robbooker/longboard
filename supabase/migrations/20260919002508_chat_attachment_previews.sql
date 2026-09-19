-- Service-only derivatives of already scanned bytes; private bucket stays private.
alter table public.chat_attachments
 add column preview_path text,
 add column preview_width integer check(preview_width between 1 and 640),
 add column preview_height integer check(preview_height between 1 and 640),
 add column preview_token uuid,
 add column preview_started_at timestamptz,
 add column preview_unavailable boolean not null default false,
 add constraint chat_attachment_preview_dimensions check ((preview_width is null)=(preview_height is null)),
 add constraint chat_attachment_preview_path check (preview_width is null or preview_path is not null);
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'image/webp') where id='chat-attachments' and not ('image/webp'=any(allowed_mime_types));

-- Register the object path BEFORE uploading. Deletion/cancellation and lease
-- replacement queue cleanup even when a renderer crashes or finishes late.
create function public.queue_chat_preview_cleanup() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.preview_path is not null and (TG_OP='DELETE' or old.preview_path is distinct from new.preview_path) then
  insert into public.chat_attachment_deletions(path,not_before) values(old.preview_path,now()+interval '5 minutes') on conflict do nothing;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.queue_chat_preview_cleanup() from public,anon,authenticated;
grant execute on function public.queue_chat_preview_cleanup() to service_role;
create trigger chat_preview_cleanup after delete or update of preview_path on public.chat_attachments for each row execute function public.queue_chat_preview_cleanup();
