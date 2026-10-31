-- #338: FAQ suggestions get a review step. A member's suggestion waits for an admin, who edits and
-- approves it (then, and only then, it becomes a FAQ item) or rejects it. Marketing HQ is the review
-- screen; Longboard keeps all the data.
--
--  * chat_faq_suggestions: status pending/approved/rejected, plus the AI's draft (ai_status, ai_topic,
--    ai_answer). `topic` stays the member's own words as submitted. The draft is only a suggestion:
--    nothing reads it onto the FAQ except an admin's approve, which sends the final text itself.
--  * chat_faq_suggestion_events: the append-only history. Who (a name kept as text, so it outlives the
--    member) and when, and on approve the exact text that was published. No update or delete grant,
--    and a trigger refuses both for any role.
--  * chat_faq_items: an optional topic, shown as "Topic - Question"; null reads exactly as before. The
--    two starter items stay null. suggestion_id links an item to the suggestion it came from, and being
--    unique it is the last guard against approving one suggestion twice.
--  * post_chat_faq_suggestion: also writes the "submitted" event and returns the suggestion's id.
--  * chat_faq_suggestions_feed: what Marketing HQ's page reads, newest first, with names and history.
--  * review_chat_faq_suggestion: the one way to approve or reject. It locks the suggestion's row, so of
--    a double click or two admins at once one acts and the other is told who already did.
--
-- Rows that exist when this runs become pending, with a "submitted" event and no AI draft.
-- (Production and preview had no suggestions on 2026-10-31.)
--
-- Function changed: post_chat_faq_suggestion. Its previous body matches production and preview
-- (compared 2026-10-31) and is in the rollback. The running app keeps working once this is applied.
-- Needs #332 (20261030220000_chat_faq.sql) first.
-- Rollback: supabase/rollbacks/20261031100000_chat_faq_review.down.sql

alter table public.chat_faq_suggestions
 add column status text not null default 'pending' check(status in ('pending','approved','rejected')),
 add column ai_status text not null default 'none' check(ai_status in ('none','pending','ready','failed')),
 add column ai_topic text check(ai_topic is null or (char_length(btrim(ai_topic)) between 1 and 60 and ai_topic !~ '[\r\n]')),
 add column ai_answer text check(ai_answer is null or char_length(btrim(ai_answer)) between 1 and 5000);

-- For the review function and the AI's draft, both server-side only.
grant update on public.chat_faq_suggestions to service_role;

alter table public.chat_faq_items
 add column topic text check(topic is null or (char_length(btrim(topic)) between 1 and 60 and topic !~ '[\r\n]')),
 add column suggestion_id uuid unique references public.chat_faq_suggestions(id) on delete set null;

create table public.chat_faq_suggestion_events(
 id uuid primary key default gen_random_uuid(),
 suggestion_id uuid not null references public.chat_faq_suggestions(id) on delete restrict,
 action text not null check(action in ('submitted','approved','rejected')),
 actor_name text not null check(char_length(btrim(actor_name)) between 1 and 80),
 actor_ref text,
 question text,
 topic text,
 answer text,
 created_at timestamptz not null default now()
);
create index chat_faq_suggestion_events_suggestion on public.chat_faq_suggestion_events(suggestion_id,created_at);
alter table public.chat_faq_suggestion_events enable row level security;
revoke all on public.chat_faq_suggestion_events from public,anon,authenticated,service_role;
grant select,insert on public.chat_faq_suggestion_events to service_role;

create function public.chat_faq_suggestion_events_append_only() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'faq_history_is_append_only'; end $$;
revoke all on function public.chat_faq_suggestion_events_append_only() from public,anon,authenticated;
create trigger chat_faq_suggestion_events_append_only before update or delete on public.chat_faq_suggestion_events
 for each row execute function public.chat_faq_suggestion_events_append_only();

insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref,created_at)
 select s.id,'submitted',coalesce(m.display_name,'Former member'),s.suggested_by::text,s.created_at
 from public.chat_faq_suggestions s left join public.longboard_chat_members m on m.id=s.suggested_by;

-- Previous body plus the event and the returned id. The AI's draft starts pending; the route fills it.
CREATE OR REPLACE FUNCTION public.post_chat_faq_suggestion(p_member uuid, p_topic text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare note_id uuid:=gen_random_uuid(); new_id uuid; who text; clean text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
begin
 if char_length(clean) not between 1 and 300 then raise exception 'invalid_faq_suggestion'; end if;
 select m.display_name into who from public.longboard_chat_members m where m.id=p_member;
 if who is null then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_faq_suggestions:'||p_member::text,0));
 if exists(select 1 from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 minute')
  or (select count(*) from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 day')>=5
 then raise exception 'faq_suggestion_rate_limited'; end if;
 insert into public.chat_faq_suggestions(message_id,topic,suggested_by,ai_status) values(note_id,clean,p_member,'pending') returning id into new_id;
 insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref) values(new_id,'submitted',who,p_member::text);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'admins','FAQ Suggestions',who||' suggested an FAQ topic: '||clean,'faq-suggestions');
 return jsonb_build_object('messageId',note_id,'posted',true,'suggestionId',new_id);
end $function$;

-- Called by /api/chat/faq/suggestions/review for an admin Marketing HQ has verified. Outcomes:
-- approved or rejected (this call did it), or already (it was decided before: nothing changes, and the
-- reply says how, by whom and when).
create function public.review_chat_faq_suggestion(p_id uuid,p_action text,p_actor_name text,p_actor_ref text,p_question text default null,p_topic text default null,p_answer text default null) returns jsonb
language plpgsql set search_path='' as $$
declare
 current_status text;
 who text:=btrim(coalesce(p_actor_name,''));
 who_ref text:=btrim(coalesce(p_actor_ref,''));
 clean_question text:=btrim(regexp_replace(coalesce(p_question,''),'\s+',' ','g'));
 clean_topic text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
 clean_answer text:=btrim(replace(replace(coalesce(p_answer,''),E'\r\n',E'\n'),E'\r',E'\n'));
 next_position integer; new_item uuid; earlier record;
begin
 if p_action is null or p_action not in ('approve','reject') then raise exception 'invalid_faq_review'; end if;
 if char_length(who) not between 1 and 80 or who_ref='' then raise exception 'invalid_faq_review'; end if;
 select s.status into current_status from public.chat_faq_suggestions s where s.id=p_id for update;
 if not found then raise exception 'faq_suggestion_not_found'; end if;
 if current_status<>'pending' then
  select e.actor_name,e.created_at into earlier from public.chat_faq_suggestion_events e
   where e.suggestion_id=p_id and e.action=current_status order by e.created_at desc limit 1;
  return jsonb_build_object('outcome','already','status',current_status,'by',earlier.actor_name,'at',earlier.created_at);
 end if;
 if p_action='reject' then
  update public.chat_faq_suggestions set status='rejected' where id=p_id;
  insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref) values(p_id,'rejected',who,who_ref);
  return jsonb_build_object('outcome','rejected','status','rejected');
 end if;
 if char_length(clean_question) not between 1 and 200 or char_length(clean_topic) not between 1 and 60 or char_length(clean_answer) not between 1 and 5000
 then raise exception 'invalid_faq_review'; end if;
 select coalesce(max(i.position),0)+10 into next_position from public.chat_faq_items i;
 insert into public.chat_faq_items(question,topic,answer,position,suggestion_id)
  values(clean_question,clean_topic,clean_answer,next_position,p_id) returning id into new_item;
 update public.chat_faq_suggestions set status='approved' where id=p_id;
 insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref,question,topic,answer)
  values(p_id,'approved',who,who_ref,clean_question,clean_topic,clean_answer);
 return jsonb_build_object('outcome','approved','status','approved','itemId',new_item);
end $$;
revoke all on function public.review_chat_faq_suggestion(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.review_chat_faq_suggestion(uuid,text,text,text,text,text,text) to service_role;

-- Everything Marketing HQ's page shows, newest first. Holds no member id, message id or email.
create function public.chat_faq_suggestions_feed(p_limit integer) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',m.display_name,'topic',s.topic,'created_at',s.created_at,'status',s.status,
   'ai_status',s.ai_status,'ai_topic',s.ai_topic,'ai_answer',s.ai_answer,
   'events',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'actor_name',e.actor_name,'question',e.question,'topic',e.topic,'answer',e.answer,'created_at',e.created_at) order by e.created_at,e.id),'[]'::jsonb)
             from public.chat_faq_suggestion_events e where e.suggestion_id=s.id)
  ) order by s.created_at desc,s.id desc),'[]'::jsonb)
 from (select * from public.chat_faq_suggestions x order by x.created_at desc,x.id desc limit greatest(p_limit,0)) s
 left join public.longboard_chat_members m on m.id=s.suggested_by;
$$;
revoke all on function public.chat_faq_suggestions_feed(integer) from public,anon,authenticated;
grant execute on function public.chat_faq_suggestions_feed(integer) to service_role;
