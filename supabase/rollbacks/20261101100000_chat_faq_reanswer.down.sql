-- Rollback of 20261101100000_chat_faq_reanswer.sql. FAQ items keep whatever was approved. A new answer still
-- waiting on an approved question is dropped from review, and the re-answer and discard history rows are
-- deleted. A rejected question that a re-answer reopened stays waiting.
drop function if exists public.reanswer_chat_faq_suggestion(uuid,text,text,text,text,text);

-- The bodies from 20261031100000_chat_faq_review.sql.
create or replace function public.review_chat_faq_suggestion(p_id uuid,p_action text,p_actor_name text,p_actor_ref text,p_question text default null,p_topic text default null,p_answer text default null) returns jsonb
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

create or replace function public.chat_faq_suggestions_feed(p_limit integer) returns jsonb
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

alter table public.chat_faq_suggestion_events disable trigger chat_faq_suggestion_events_append_only;
delete from public.chat_faq_suggestion_events where action in ('reanswered','discarded');
alter table public.chat_faq_suggestion_events enable trigger chat_faq_suggestion_events_append_only;
alter table public.chat_faq_suggestion_events drop constraint chat_faq_suggestion_events_action_check;
alter table public.chat_faq_suggestion_events drop column note;
alter table public.chat_faq_suggestion_events add constraint chat_faq_suggestion_events_action_check check(action in ('submitted','approved','rejected'));
alter table public.chat_faq_suggestions drop column reanswer_pending;
