-- Durable Buddy work is committed with the source message. No client job access.
alter table public.longboard_chat_messages add column buddy_status text
 check (buddy_status in ('pending','processing','failed','completed','cancelled'));
create table public.chat_buddy_jobs (
 message_id uuid primary key references public.longboard_chat_messages(id) on delete cascade,
 source_body text not null, source_edited_at timestamptz,
 state text not null default 'pending' check(state in ('pending','processing','failed','completed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default now(), lease_until timestamptz, worker_token uuid,
 reply_id uuid references public.longboard_chat_messages(id) on delete set null,
 error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.chat_buddy_jobs enable row level security;
revoke all on public.chat_buddy_jobs from public,anon,authenticated;
grant all on public.chat_buddy_jobs to service_role;
create index chat_buddy_jobs_due on public.chat_buddy_jobs(next_attempt_at,created_at) where state in ('pending','processing');

create function public.chat_has_buddy_mention(body text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(body ~* '(^|[^[:alnum:]_])@buddy($|[^a-zA-Z0-9_])',false);
$$;
create function public.prepare_chat_buddy_status() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.buddy_status:=case when new.room_slug='main' and new.member_id is not null and new.bot_slug is null and public.chat_has_buddy_mention(new.body) then 'pending' else null end;
 return new;
end $$;
create trigger prepare_chat_buddy_status before insert on public.longboard_chat_messages for each row execute function public.prepare_chat_buddy_status();
create function public.enqueue_chat_buddy_job() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.buddy_status='pending' then
  insert into public.chat_buddy_jobs(message_id,source_body,source_edited_at) values(new.id,new.body,new.edited_at) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger enqueue_chat_buddy_job after insert on public.longboard_chat_messages for each row execute function public.enqueue_chat_buddy_job();

-- Paused rooms must still be able to settle internal work status. All content,
-- attachment, author, room and other mutations retain the original pause guard.
create or replace function public.enforce_longboard_chat_open()
returns trigger language plpgsql security invoker set search_path=public as $$
declare target_room text;
begin
 if tg_table_name='longboard_chat_messages' then
  if tg_op='UPDATE' then
   -- Generated search_document is recomputed after BEFORE triggers.
   if (to_jsonb(new)-array['buddy_status','search_document'])=(to_jsonb(old)-array['buddy_status','search_document']) then return new; end if;
   if new.room_slug<>old.room_slug then raise exception 'longboard_chat_room_immutable' using errcode='P0001'; end if;
  end if;
  target_room:=new.room_slug;
 else select room_slug into target_room from public.longboard_chat_messages where id=new.message_id;
 end if;
 if not exists(select 1 from public.longboard_chat_room_state where room_slug=target_room and is_open) then raise exception 'longboard_chat_paused' using errcode='P0001'; end if;
 return new;
end $$;

-- Always lock source before job; edits/deletes already hold the source lock.
create function public.invalidate_chat_buddy_job() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.body is distinct from old.body or new.edited_at is distinct from old.edited_at then
  update public.chat_buddy_jobs set state='cancelled',worker_token=null,lease_until=null,error_code='source_changed',updated_at=now()
   where message_id=new.id and state in ('pending','processing');
  if found then update public.longboard_chat_messages set buddy_status='cancelled' where id=new.id; end if;
 end if;
 return new;
end $$;
create trigger invalidate_chat_buddy_job after update of body,edited_at on public.longboard_chat_messages for each row execute function public.invalidate_chat_buddy_job();

-- Caller holds source/job locks. Shared locks serialize entitlement revocation
-- and room pauses with reply insertion. No browser/session credentials are stored.
create function public.guard_chat_buddy_source(source uuid,expected_body text,expected_edited timestamptz) returns text
language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_messages; account uuid; lb uuid; opened boolean;
begin
 select * into m from public.longboard_chat_messages where id=source for update;
 if not found then return 'cancelled'; end if;
 if m.room_slug<>'main' or m.member_id is null or m.bot_slug is not null or m.body is distinct from expected_body or m.edited_at is distinct from expected_edited then return 'cancelled'; end if;
 select user_id into account from public.longboard_chat_members where id=m.member_id for share;
 select longboard_user_id into lb from public.chat_accounts where id=account for share;
 perform 1 from public.profiles where id=lb for share;
 perform 1 from public.user_tags where user_id=lb for share;
 if public.chat_account_has_room(account,'main') is distinct from true then return 'cancelled'; end if;
 select is_open into opened from public.longboard_chat_room_state where room_slug='main' for share;
 if opened is distinct from true then return 'paused'; end if;
 return 'ok';
end $$;

create function public.claim_chat_buddy_job(worker uuid,source uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate uuid; m public.longboard_chat_messages; j public.chat_buddy_jobs; guard text; existing_reply uuid;
begin
 if worker is null then raise exception 'worker_required'; end if;
 for candidate in select message_id from public.chat_buddy_jobs where (source is null or message_id=source) and
  ((state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<=now())) order by next_attempt_at,created_at limit 20 loop
  select * into m from public.longboard_chat_messages where id=candidate for update skip locked;
  if not found then continue; end if;
  select * into j from public.chat_buddy_jobs where message_id=candidate and ((state='pending' and next_attempt_at<=now()) or (state='processing' and lease_until<=now())) for update skip locked;
  if not found then continue; end if;
  guard:=public.guard_chat_buddy_source(candidate,j.source_body,j.source_edited_at);
  if guard='cancelled' or j.attempts>=3 then
   update public.chat_buddy_jobs set state=case when guard='cancelled' then 'cancelled' else 'failed' end,worker_token=null,lease_until=null,error_code=case when guard='cancelled' then 'source_unavailable' else 'retry_limit' end,updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status=case when guard='cancelled' then 'cancelled' else 'failed' end where id=candidate;
   continue;
  end if;
  if guard='paused' then
   update public.chat_buddy_jobs set state='pending',worker_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute',updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status='pending' where id=candidate;
   continue;
  end if;
  -- An older server may already have answered during a rolling deployment.
  select id into existing_reply from public.longboard_chat_messages where bot_slug='buddy' and reply_to_id=candidate;
  if existing_reply is not null then
   update public.chat_buddy_jobs set state='completed',reply_id=existing_reply,worker_token=null,lease_until=null,error_code=null,updated_at=now() where message_id=candidate;
   update public.longboard_chat_messages set buddy_status='completed' where id=candidate;
   continue;
  end if;
  update public.chat_buddy_jobs set state='processing',attempts=attempts+1,worker_token=worker,lease_until=now()+interval '90 seconds',updated_at=now() where message_id=candidate;
  update public.longboard_chat_messages set buddy_status='processing' where id=candidate;
  return jsonb_build_object('messageId',candidate,'body',j.source_body,'createdAt',m.created_at);
 end loop;
 return null;
end $$;

create function public.finish_chat_buddy_job(source uuid,worker uuid,answer text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.chat_buddy_jobs; guard text; response uuid; next_state text;
begin
 perform 1 from public.longboard_chat_messages where id=source for update;
 if not found then return false; end if;
 select * into j from public.chat_buddy_jobs where message_id=source for update;
 if not found or worker is null or j.worker_token is distinct from worker or j.state<>'processing' or j.lease_until<=now() then return false; end if;
 guard:=public.guard_chat_buddy_source(source,j.source_body,j.source_edited_at);
 if guard='cancelled' then next_state:='cancelled';
 elsif guard='paused' then next_state:='pending';
 elsif answer is null then next_state:=case when j.attempts>=3 then 'failed' else 'pending' end;
 else
  if length(btrim(answer)) not between 1 and 600 then raise exception 'invalid_buddy_reply'; end if;
  insert into public.longboard_chat_messages(room_slug,guest_id,author_label,body,bot_slug,reply_to_id)
   values('main',null,'@Buddy',btrim(answer),'buddy',source)
   on conflict (reply_to_id) where bot_slug='buddy' and reply_to_id is not null do nothing returning id into response;
  if response is null then select id into response from public.longboard_chat_messages where bot_slug='buddy' and reply_to_id=source; end if;
  if response is null then raise exception 'reply_save_failed'; end if;
  next_state:='completed';
 end if;
 update public.chat_buddy_jobs set state=next_state,reply_id=response,worker_token=null,lease_until=null,
  next_attempt_at=now()+case when guard='paused' then interval '1 minute' when j.attempts=1 then interval '30 seconds' else interval '2 minutes' end,
  error_code=case when next_state='failed' then 'reply_unavailable' when next_state='cancelled' then 'source_unavailable' else null end,updated_at=now() where message_id=source;
 update public.longboard_chat_messages set buddy_status=next_state where id=source;
 return true;
end $$;
revoke all on function public.chat_has_buddy_mention(text),public.prepare_chat_buddy_status(),public.enqueue_chat_buddy_job(),public.invalidate_chat_buddy_job(),public.guard_chat_buddy_source(uuid,text,timestamptz),public.claim_chat_buddy_job(uuid,uuid),public.finish_chat_buddy_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.chat_has_buddy_mention(text),public.prepare_chat_buddy_status(),public.enqueue_chat_buddy_job(),public.invalidate_chat_buddy_job(),public.guard_chat_buddy_source(uuid,text,timestamptz),public.claim_chat_buddy_job(uuid,uuid),public.finish_chat_buddy_job(uuid,uuid,text) to service_role;
