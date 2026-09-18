alter table public.chat_attachments drop constraint chat_attachments_mime_type_check;
alter table public.chat_attachments add constraint chat_attachments_mime_type_check check(mime_type in ('application/pdf','image/jpeg','image/png','image/gif','audio/wav'));
alter table public.chat_attachments add column duration_seconds double precision;
alter table public.chat_attachments add constraint chat_voice_limits check(mime_type<>'audio/wav' or (byte_size<=5000000 and (status not in ('ready','attached') or (duration_seconds>0 and duration_seconds<=120 and duration_seconds is not null))));
update storage.buckets set allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/gif','audio/wav'] where id='chat-attachments';
create table public.chat_audio_transcripts(
 attachment_id uuid primary key references public.chat_attachments(id) on delete cascade,
 status text not null check(status in ('processing','ready','failed')),
 text text check(length(text)<=16000),
 claim_token uuid,started_at timestamptz not null default now(),attempts integer not null default 0 check(attempts between 0 and 3),
 check(status<>'ready' or text is not null)
);
create table public.chat_audio_usage(member_id uuid references public.longboard_chat_members(id) on delete cascade,hour timestamptz,requests integer not null check(requests between 0 and 30),primary key(member_id,hour));
alter table public.chat_audio_transcripts enable row level security;
alter table public.chat_audio_usage enable row level security;
revoke all on public.chat_audio_transcripts,public.chat_audio_usage from public,anon,authenticated;
grant all on public.chat_audio_transcripts,public.chat_audio_usage to service_role;
create function public.claim_chat_transcript(actor uuid,file_id uuid,token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.chat_attachments;r public.chat_audio_transcripts;c public.longboard_chat_conversations;hour_start timestamptz:=date_trunc('hour',now());
begin
 select * into a from public.chat_attachments where id=file_id for update;
 if actor is null or token is null or not found or a.status<>'attached' or a.mime_type<>'audio/wav' then raise exception 'audio_unavailable';end if;
 if a.conversation_id is not null then
  select * into c from public.longboard_chat_conversations where id=a.conversation_id;
  if not found or not exists(select 1 from public.longboard_chat_members m where m.id=actor and public.chat_account_has_room(m.user_id,'social')) or actor not in (c.requester_id,c.recipient_id) or c.status<>'accepted' or exists(select 1 from public.longboard_chat_blocks where (blocker_id=c.requester_id and blocked_id=c.recipient_id) or (blocker_id=c.recipient_id and blocked_id=c.requester_id)) or not exists(select 1 from public.longboard_chat_direct_messages where id=a.dm_message_id and conversation_id=c.id and deleted_at is null and a.id=any(attachment_ids)) then raise exception 'audio_unavailable';end if;
 else
  if not exists(select 1 from public.longboard_chat_members m where m.id=actor and public.chat_account_has_room(m.user_id,a.room_slug)) or not exists(select 1 from public.longboard_chat_messages where id=a.room_message_id and room_slug=a.room_slug and a.id=any(attachment_ids)) then raise exception 'audio_unavailable';end if;
 end if;
 select * into r from public.chat_audio_transcripts where attachment_id=file_id;
 if r.status='ready' then return jsonb_build_object('status','ready','text',r.text);end if;
 if r.status='processing' and r.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing');end if;
 if coalesce(r.attempts,0)>=3 then raise exception 'transcript_retry_limit';end if;
 perform pg_advisory_xact_lock(hashtextextended('voice-usage:'||actor::text,0));
 insert into public.chat_audio_usage values(actor,hour_start,0) on conflict do nothing;
 update public.chat_audio_usage set requests=requests+1 where member_id=actor and hour=hour_start and requests<30;
 if not found then raise exception 'transcript_rate_limit';end if;
 insert into public.chat_audio_transcripts(attachment_id,status,claim_token,attempts) values(file_id,'processing',token,1)
 on conflict(attachment_id) do update set status='processing',claim_token=token,started_at=now(),attempts=chat_audio_transcripts.attempts+1;
 return jsonb_build_object('status','claimed');
end $$;
revoke all on function public.claim_chat_transcript(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_chat_transcript(uuid,uuid,uuid) to service_role;
