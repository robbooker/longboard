-- Rollback of 20261031100000_chat_faq_review.sql. Approved questions stay on the FAQ page as plain
-- questions (their topic is dropped); the review status, AI drafts and history are lost.
drop function if exists public.review_chat_faq_suggestion(uuid,text,text,text,text,text,text);
drop function if exists public.chat_faq_suggestions_feed(integer);

-- The body from 20261030220000_chat_faq.sql, as on production and preview on 2026-10-31.
CREATE OR REPLACE FUNCTION public.post_chat_faq_suggestion(p_member uuid, p_topic text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare note_id uuid:=gen_random_uuid(); who text; clean text:=btrim(regexp_replace(coalesce(p_topic,''),'\s+',' ','g'));
begin
 if char_length(clean) not between 1 and 300 then raise exception 'invalid_faq_suggestion'; end if;
 select m.display_name into who from public.longboard_chat_members m where m.id=p_member;
 if who is null then raise exception 'member_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat_faq_suggestions:'||p_member::text,0));
 if exists(select 1 from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 minute')
  or (select count(*) from public.chat_faq_suggestions s where s.suggested_by=p_member and s.created_at>now()-interval '1 day')>=5
 then raise exception 'faq_suggestion_rate_limited'; end if;
 insert into public.chat_faq_suggestions(message_id,topic,suggested_by) values(note_id,clean,p_member);
 insert into public.longboard_chat_messages(id,room_slug,author_label,body,bot_slug)
  values(note_id,'admins','FAQ Suggestions',who||' suggested an FAQ topic: '||clean,'faq-suggestions');
 return jsonb_build_object('messageId',note_id,'posted',true);
end $function$;

drop table if exists public.chat_faq_suggestion_events;
drop function if exists public.chat_faq_suggestion_events_append_only();
alter table public.chat_faq_items drop column if exists suggestion_id, drop column if exists topic;
alter table public.chat_faq_suggestions drop column if exists status, drop column if exists ai_status, drop column if exists ai_topic, drop column if exists ai_answer;
revoke update on public.chat_faq_suggestions from service_role;
