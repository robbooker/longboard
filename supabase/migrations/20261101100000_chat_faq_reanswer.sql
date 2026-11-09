-- #344: an admin can ask for a new AI answer to any FAQ suggestion, with an optional note on what was
-- wrong. Nothing reaches the FAQ page until an admin approves it:
--
--  * Waiting: the new answer replaces the draft.
--  * Rejected: the new answer replaces the draft and the question goes back to waiting.
--  * Approved: the public answer stays exactly as it is. The new answer waits as a draft, with
--    reanswer_pending set. Approving it updates the same FAQ item (or adds it back if an admin has since
--    removed it). Discarding it keeps the public answer and leaves the question approved.
--
-- Why this needs a migration: approving a second answer has to change the FAQ item and write history in one
-- locked step, and history needs to say who asked and why.
--
--  * chat_faq_suggestions.reanswer_pending: an approved question has a new answer waiting.
--  * chat_faq_suggestion_events: new actions 'reanswered' and 'discarded', and a note column.
--  * reanswer_chat_faq_suggestion: new; the only way to save a re-answer. It never touches chat_faq_items.
--  * review_chat_faq_suggestion and chat_faq_suggestions_feed: same signatures, extended as above.
--
-- The running app and Marketing HQ keep working once this is applied. Needs
-- 20261031100000_chat_faq_review.sql first.
-- Rollback: supabase/rollbacks/20261101100000_chat_faq_reanswer.down.sql

alter table public.chat_faq_suggestions add column reanswer_pending boolean not null default false;

alter table public.chat_faq_suggestion_events drop constraint chat_faq_suggestion_events_action_check;
alter table public.chat_faq_suggestion_events
 add constraint chat_faq_suggestion_events_action_check check(action in ('submitted','approved','rejected','reanswered','discarded')),
 add column note text check(note is null or char_length(note)<=1000);

-- Called by /api/chat/faq/suggestions/reanswer for an admin Marketing HQ has verified.
create function public.reanswer_chat_faq_suggestion(p_id uuid,p_actor_name text,p_actor_ref text,p_note text,p_topic text,p_answer text) returns jsonb
language plpgsql set search_path='' as $$
declare
 current_status text;
 who text:=btrim(coalesce(p_actor_name,''));
 who_ref text:=btrim(coalesce(p_actor_ref,''));
 clean_note text:=nullif(btrim(coalesce(p_note,'')),'');
 clean_topic text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
 clean_answer text:=btrim(replace(replace(coalesce(p_answer,''),E'\r\n',E'\n'),E'\r',E'\n'));
 next_status text;
begin
 if char_length(who) not between 1 and 80 or who_ref='' or char_length(clean_topic) not between 1 and 60
  or char_length(clean_answer) not between 1 and 5000 or char_length(coalesce(clean_note,''))>1000
 then raise exception 'invalid_faq_reanswer'; end if;
 select s.status into current_status from public.chat_faq_suggestions s where s.id=p_id for update;
 if not found then raise exception 'faq_suggestion_not_found'; end if;
 next_status:=case current_status when 'rejected' then 'pending' else current_status end;
 update public.chat_faq_suggestions set status=next_status,ai_status='ready',ai_topic=clean_topic,ai_answer=clean_answer,
  reanswer_pending=(current_status='approved') where id=p_id;
 insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref,topic,answer,note)
  values(p_id,'reanswered',who,who_ref,clean_topic,clean_answer,clean_note);
 return jsonb_build_object('outcome','reanswered','status',next_status,'reanswerPending',current_status='approved');
end $$;
revoke all on function public.reanswer_chat_faq_suggestion(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reanswer_chat_faq_suggestion(uuid,text,text,text,text,text) to service_role;

-- As before, plus a decision on a re-answer waiting on an approved question.
create or replace function public.review_chat_faq_suggestion(p_id uuid,p_action text,p_actor_name text,p_actor_ref text,p_question text default null,p_topic text default null,p_answer text default null) returns jsonb
language plpgsql set search_path='' as $$
declare
 current_status text;
 waiting boolean;
 who text:=btrim(coalesce(p_actor_name,''));
 who_ref text:=btrim(coalesce(p_actor_ref,''));
 clean_question text:=btrim(regexp_replace(coalesce(p_question,''),'\s+',' ','g'));
 clean_topic text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
 clean_answer text:=btrim(replace(replace(coalesce(p_answer,''),E'\r\n',E'\n'),E'\r',E'\n'));
 next_position integer; new_item uuid; earlier record;
begin
 if p_action is null or p_action not in ('approve','reject') then raise exception 'invalid_faq_review'; end if;
 if char_length(who) not between 1 and 80 or who_ref='' then raise exception 'invalid_faq_review'; end if;
 select s.status,s.reanswer_pending into current_status,waiting from public.chat_faq_suggestions s where s.id=p_id for update;
 if not found then raise exception 'faq_suggestion_not_found'; end if;
 if current_status<>'pending' and not waiting then
  select e.actor_name,e.created_at into earlier from public.chat_faq_suggestion_events e
   where e.suggestion_id=p_id and e.action=current_status order by e.created_at desc limit 1;
  return jsonb_build_object('outcome','already','status',current_status,'by',earlier.actor_name,'at',earlier.created_at);
 end if;
 if p_action='reject' and waiting then
  update public.chat_faq_suggestions set reanswer_pending=false where id=p_id;
  insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref) values(p_id,'discarded',who,who_ref);
  return jsonb_build_object('outcome','discarded','status','approved');
 end if;
 if p_action='reject' then
  update public.chat_faq_suggestions set status='rejected' where id=p_id;
  insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref) values(p_id,'rejected',who,who_ref);
  return jsonb_build_object('outcome','rejected','status','rejected');
 end if;
 if char_length(clean_question) not between 1 and 200 or char_length(clean_topic) not between 1 and 60 or char_length(clean_answer) not between 1 and 5000
 then raise exception 'invalid_faq_review'; end if;
 update public.chat_faq_items set question=clean_question,topic=clean_topic,answer=clean_answer,updated_at=now() where suggestion_id=p_id returning id into new_item;
 if new_item is null then
  select coalesce(max(i.position),0)+10 into next_position from public.chat_faq_items i;
  insert into public.chat_faq_items(question,topic,answer,position,suggestion_id)
   values(clean_question,clean_topic,clean_answer,next_position,p_id) returning id into new_item;
 end if;
 update public.chat_faq_suggestions set status='approved',reanswer_pending=false where id=p_id;
 insert into public.chat_faq_suggestion_events(suggestion_id,action,actor_name,actor_ref,question,topic,answer)
  values(p_id,'approved',who,who_ref,clean_question,clean_topic,clean_answer);
 return jsonb_build_object('outcome','approved','status','approved','itemId',new_item);
end $$;

-- As before, plus reanswer_pending and each event's note.
create or replace function public.chat_faq_suggestions_feed(p_limit integer) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',m.display_name,'topic',s.topic,'created_at',s.created_at,'status',s.status,
   'ai_status',s.ai_status,'ai_topic',s.ai_topic,'ai_answer',s.ai_answer,'reanswer_pending',s.reanswer_pending,
   'events',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'actor_name',e.actor_name,'question',e.question,'topic',e.topic,'answer',e.answer,'note',e.note,'created_at',e.created_at) order by e.created_at,e.id),'[]'::jsonb)
             from public.chat_faq_suggestion_events e where e.suggestion_id=s.id)
  ) order by s.created_at desc,s.id desc),'[]'::jsonb)
 from (select * from public.chat_faq_suggestions x order by x.created_at desc,x.id desc limit greatest(p_limit,0)) s
 left join public.longboard_chat_members m on m.id=s.suggested_by;
$$;
