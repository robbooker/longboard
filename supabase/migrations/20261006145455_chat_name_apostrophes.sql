-- Accept straight and curly apostrophes without changing name ownership or uniqueness.
create or replace function public.chat_update_member_name(p_account uuid,p_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.longboard_chat_members; clean text;
begin
 clean:=btrim(regexp_replace(normalize(p_name,NFKC),'[[:space:]]+',' ','g'));
 if clean is null or char_length(clean) not between 2 and 28
  or clean !~ '^[[:alnum:]][[:alnum:] _.''‘’-]*$'
  or lower(clean) in ('buddy','longboard','longboard admin')
  or regexp_split_to_array(lower(clean),'[^[:alnum:]]+') && array['fuck','fucking','motherfucker','shit','bullshit','bitch','cunt','nigger','nigga','faggot']
 then raise exception 'invalid_display_name'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-member:' || p_account::text,0));
 select * into m from public.longboard_chat_members where user_id=p_account for update;
 if not found or not public.chat_account_has_room(p_account,'social') then raise exception 'member_required'; end if;
 if m.display_name=clean then return to_jsonb(m); end if;
 -- The unique member-name index arbitrates collisions, including concurrent saves.
 update public.longboard_chat_members set display_name=clean,name_revision=name_revision+1 where id=m.id returning * into m;
 update public.longboard_chat_guests set display_name=clean,updated_at=now() where id=m.id;
 return to_jsonb(m);
end $$;
revoke all on function public.chat_update_member_name(uuid,text) from public,anon,authenticated;
grant execute on function public.chat_update_member_name(uuid,text) to service_role;
