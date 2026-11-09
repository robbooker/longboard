-- #410 Profile pictures: members can add their own picture in Profile settings.
--
--  * longboard_chat_members.avatar_path: the random name (a uuid) of the member's current picture,
--    or null for the initials tile. The picture lives in chat-avatars as <uuid>-256.webp and
--    <uuid>-64.webp; a new picture always gets a new name, so the files never change (cached for a year).
--  * chat-avatars: a PUBLIC-read storage bucket for those WebP files only, at most 1 MB each. Only the
--    server writes or deletes (service role); there are no storage policies, so a browser can only read.
--  * chat-avatar-uploads: a PRIVATE bucket where the member's browser sends the original photo (up to
--    10 MB, through a one-time upload link the server signs). The server replaces it with a cleaned
--    copy (rotated, no metadata or location) as soon as it reads it, and deletes it after saving.
--  * chat_avatar_uploads: one row per upload, for the per-member limit (10 an hour, 30 a day) and to
--    make sure a saved picture came from that member's own upload. RLS on, no policies, service role only.
--  * chat_avatar_reserve / chat_avatar_set / chat_avatar_clear: called only by /api/chat/avatar (service
--    role). set and clear return the previous picture's name so the server deletes its files.
--
-- Additive: nothing existing changes. Until it is applied, members just see initials and the picture
-- section says pictures are unavailable.
-- Rollback: supabase/rollbacks/20261110180000_chat_member_avatars.down.sql

alter table public.longboard_chat_members add column if not exists avatar_path text
  check (avatar_path is null or avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-avatars','chat-avatars',true,1048576,array['image/webp'])
on conflict (id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-avatar-uploads','chat-avatar-uploads',false,10485760,array['application/octet-stream','image/webp'])
on conflict (id) do nothing;

create table public.chat_avatar_uploads(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 created_at timestamptz not null default now(),
 used_at timestamptz
);
create index chat_avatar_uploads_member_idx on public.chat_avatar_uploads(member_id,created_at desc);
alter table public.chat_avatar_uploads enable row level security;
revoke all on public.chat_avatar_uploads from public,anon,authenticated;
grant select,insert,update,delete on public.chat_avatar_uploads to service_role;

-- A new upload for this member, unless they have started 10 in the last hour or 30 in the last day.
create function public.chat_avatar_reserve(p_member uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.longboard_chat_members where id=p_member) then raise exception 'member_required'; end if;
  perform pg_advisory_xact_lock(hashtext('chat_avatar_reserve:'||p_member::text));
  if (select count(*) from public.chat_avatar_uploads where member_id=p_member and created_at>now()-interval '1 hour')>=10
    or (select count(*) from public.chat_avatar_uploads where member_id=p_member and created_at>now()-interval '1 day')>=30
  then raise exception 'avatar_rate_limited'; end if;
  delete from public.chat_avatar_uploads where member_id=p_member and created_at<now()-interval '2 days';
  insert into public.chat_avatar_uploads(member_id) values(p_member) returning id into v_id;
  return v_id;
end $$;

-- Uses one unused upload of this member (from the last day) and makes p_path their picture.
-- Returns the previous picture's name (or null).
create function public.chat_avatar_set(p_member uuid, p_upload uuid, p_path text) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  update public.chat_avatar_uploads set used_at=now()
   where id=p_upload and member_id=p_member and used_at is null and created_at>now()-interval '1 day';
  if not found then raise exception 'avatar_upload_invalid'; end if;
  select avatar_path into v_old from public.longboard_chat_members where id=p_member for update;
  if not found then raise exception 'member_required'; end if;
  update public.longboard_chat_members set avatar_path=p_path where id=p_member;
  return v_old;
end $$;

-- Back to initials. Returns the removed picture's name (or null when there was none).
create function public.chat_avatar_clear(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  select avatar_path into v_old from public.longboard_chat_members where id=p_member for update;
  if not found then raise exception 'member_required'; end if;
  if v_old is not null then update public.longboard_chat_members set avatar_path=null where id=p_member; end if;
  return v_old;
end $$;

revoke all on function public.chat_avatar_reserve(uuid), public.chat_avatar_set(uuid,uuid,text), public.chat_avatar_clear(uuid) from public,anon,authenticated;
grant execute on function public.chat_avatar_reserve(uuid), public.chat_avatar_set(uuid,uuid,text), public.chat_avatar_clear(uuid) to service_role;
