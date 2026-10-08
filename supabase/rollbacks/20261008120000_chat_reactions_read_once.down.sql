-- Rollback for 20261008120000_chat_reactions_read_once.sql: the production definition captured on 2026-10-08.
CREATE OR REPLACE FUNCTION public.read_chat_message_reactions(p_actor uuid, p_room text, p_conversation uuid, p_messages uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare mid uuid; actor uuid; result jsonb:='{}'; items jsonb;
begin
 if coalesce(cardinality(p_messages),0) not between 1 and 100 then raise exception 'invalid_target'; end if;
 foreach mid in array p_messages loop
  begin
   actor:=public.check_chat_reaction_target(p_actor,p_room,p_conversation,mid,false);
   with reactions as (
    select r.emoji,r.member_id,g.display_name from public.chat_message_reaction_choices r join public.longboard_chat_members g on g.id=r.member_id
    where r.active and ((p_room is not null and r.room_message_id=mid) or (p_conversation is not null and r.dm_message_id=mid))
    union all
    select 'like',r.guest_id,g.display_name from public.longboard_chat_reactions r join public.longboard_chat_guests g on g.id=r.guest_id
    where p_room is not null and r.message_id=mid and r.active
   ), grouped as (
    select emoji,count(*) as count,bool_or(member_id=actor) as mine,(array_agg(display_name order by display_name,member_id))[1:10] as names from reactions group by emoji
   ) select coalesce(jsonb_agg(to_jsonb(grouped)),'[]') into items from grouped;
   result:=result||jsonb_build_object(mid::text,items);
  exception when raise_exception then
   if sqlerrm in ('message_not_found','conversation_not_found','conversation_unavailable','room_forbidden','member_required') then result:=result||jsonb_build_object(mid::text,'[]'::jsonb); else raise; end if;
  end;
 end loop;
 return result;
end $function$
;
