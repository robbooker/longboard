-- read_chat_message_reactions ran check_chat_reaction_target once per requested message (up to
-- 100): a member lookup, chat_account_has_room (ShortScout identity, profile, tags), message and
-- block lookups, each inside its own exception sub-transaction. Every reactions reload for 80
-- visible messages repeated all of that 80 times (3.3M calls, ~76 h of DB time Sep 28-Oct 7).
-- Resolve the member, room access, conversation and blocks once per call, then aggregate all
-- requested messages in one query. Read path only; writes keep check_chat_reaction_target.
-- Same results as before, including '[]' for every message the old checks swallowed
-- (member_required, room_forbidden, conversation_not_found/unavailable, message_not_found).
create or replace function public.read_chat_message_reactions(p_actor uuid, p_room text, p_conversation uuid, p_messages uuid[])
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
 actor uuid; other uuid; c public.longboard_chat_conversations;
 empty jsonb; matched jsonb;
begin
 if coalesce(cardinality(p_messages),0) not between 1 and 100 then raise exception 'invalid_target'; end if;
 empty := (select jsonb_object_agg(mid::text, '[]'::jsonb) from unnest(p_messages) mid);
 -- Same order as check_chat_reaction_target: a missing member wins over an invalid target.
 select id into actor from public.longboard_chat_members where user_id = p_actor;
 if actor is null then return empty; end if;
 if (p_room is null) = (p_conversation is null) then raise exception 'invalid_target'; end if;
 if p_room is not null then
  if not public.chat_account_has_room(p_actor, p_room) then return empty; end if;
  select jsonb_object_agg(msg.id::text, coalesce((
    select jsonb_agg(to_jsonb(grouped)) from (
     select reactions.emoji, count(*) as count, bool_or(reactions.member_id = actor) as mine,
      (array_agg(reactions.display_name order by reactions.display_name, reactions.member_id))[1:10] as names
     from (
      select r.emoji, r.member_id, g.display_name from public.chat_message_reaction_choices r
       join public.longboard_chat_members g on g.id = r.member_id
       where r.active and r.room_message_id = msg.id
      union all
      select 'like', r.guest_id, g.display_name from public.longboard_chat_reactions r
       join public.longboard_chat_guests g on g.id = r.guest_id
       where r.message_id = msg.id and r.active
     ) reactions group by reactions.emoji
    ) grouped), '[]'::jsonb))
  into matched
  from public.longboard_chat_messages msg
  where msg.id = any(p_messages) and msg.room_slug = p_room and msg.deleted_at is null
   and not exists(select 1 from public.longboard_chat_blocks b
    where (b.blocker_id = actor and b.blocked_id = msg.member_id) or (b.blocker_id = msg.member_id and b.blocked_id = actor));
 else
  if not public.chat_account_has_room(p_actor, 'social') then return empty; end if;
  select * into c from public.longboard_chat_conversations where id = p_conversation and actor in (requester_id, recipient_id);
  if not found then return empty; end if;
  other := case when c.requester_id = actor then c.recipient_id else c.requester_id end;
  if c.status <> 'accepted' or exists(select 1 from public.longboard_chat_blocks b
   where (b.blocker_id = actor and b.blocked_id = other) or (b.blocker_id = other and b.blocked_id = actor)) then return empty; end if;
  select jsonb_object_agg(msg.id::text, coalesce((
    select jsonb_agg(to_jsonb(grouped)) from (
     select reactions.emoji, count(*) as count, bool_or(reactions.member_id = actor) as mine,
      (array_agg(reactions.display_name order by reactions.display_name, reactions.member_id))[1:10] as names
     from (
      select r.emoji, r.member_id, g.display_name from public.chat_message_reaction_choices r
       join public.longboard_chat_members g on g.id = r.member_id
       where r.active and r.dm_message_id = msg.id
     ) reactions group by reactions.emoji
    ) grouped), '[]'::jsonb))
  into matched
  from public.longboard_chat_direct_messages msg
  where msg.id = any(p_messages) and msg.conversation_id = c.id and msg.deleted_at is null;
 end if;
 return empty || coalesce(matched, '{}'::jsonb);
end $function$;
