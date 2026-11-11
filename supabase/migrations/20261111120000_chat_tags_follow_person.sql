-- #439 @tags follow the person through name changes.
--
-- Before: a tag was only the text "@Name". The database turned it into a notification once, when
-- the message was sent (record_chat_room_mentions, by the names members had at that moment), and
-- every screen turned it back into a member by matching the text against members' *current* names.
-- So after a rename, old tags were plain text with no link, and editing an old message dropped the
-- notification (the edit re-read the text, and the old name no longer matched anyone).
--
-- After:
--  * chat_message_tags: one row per tag in a room message, holding the member it points to
--    (member id) and the text it was typed as. Written by a trigger when a message is sent or
--    edited. An edit keeps the person of every tag whose text is still there, so a tag typed as
--    an old name stays theirs.
--  * record_chat_room_mentions now notifies the people in chat_message_tags (same rooms, same
--    eligibility, block and self rules as before) instead of matching names a second time.
--  * chat_member_names: every name a member has had. Filled from current names here, kept up to
--    date by a trigger on renames, and filled with older names from the messages' author_label
--    (the name each message was sent under) by the backfill below.
--  * chat_tag_lookup: for shown messages, the member and current name of each stored tag (and,
--    as before, members by current name for text with no stored tags, such as DMs).
--  * chat_tag_suggestions: the @ list. One row per member: current names first, then members whose
--    earlier name matches what was typed (shown with their current name), unless that earlier
--    name has belonged to anyone else.
--  * Backfill, in small batches, not in this migration: chat_tags_backfill_step(limit) is called
--    repeatedly by scripts/chat-tags-backfill.mjs (pauses between batches) until it reports done.
--    It only inserts into chat_member_names and chat_message_tags; it never rewrites messages and
--    never creates notifications (a notification row would send a push). A name that more than one
--    member has had is left alone unless the message's own notification says who was meant; those
--    tags are counted as `ambiguous` and keep today's behavior (matched by current name).
--
-- Additive: the code checks for the new functions and falls back to the old lookups without them.
-- Rollback: supabase/rollbacks/20261111120000_chat_tags_follow_person.down.sql.

create table public.chat_member_names (
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 name_key text not null,
 display_name text not null,
 created_at timestamptz not null default now(),
 primary key(member_id,name_key)
);
create index chat_member_names_key_idx on public.chat_member_names(name_key);
alter table public.chat_member_names enable row level security;
revoke all on public.chat_member_names from public,anon,authenticated;
grant all on public.chat_member_names to service_role;
insert into public.chat_member_names(member_id,name_key,display_name)
 select id,lower(display_name),display_name from public.longboard_chat_members on conflict do nothing;

create function public.remember_chat_member_name() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.chat_member_names(member_id,name_key,display_name) values(new.id,lower(new.display_name),new.display_name)
 on conflict do nothing;
 return new;
end $$;
create trigger chat_member_name_history after insert or update of display_name on public.longboard_chat_members
 for each row execute function public.remember_chat_member_name();

create table public.chat_message_tags (
 message_id uuid not null references public.longboard_chat_messages(id) on delete cascade,
 tag_key text not null,
 tagged_as text not null,
 member_id uuid not null references public.longboard_chat_members(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(message_id,tag_key)
);
create index chat_message_tags_member_idx on public.chat_message_tags(member_id);
alter table public.chat_message_tags enable row level security;
revoke all on public.chat_message_tags from public,anon,authenticated;
grant all on public.chat_message_tags to service_role;

-- The tags in a message body, read the way record_chat_room_mentions always has: an "@" not after a
-- letter, digit, "_" or "@", then the longest name that does not run on into a letter or digit.
-- Live (p_history false): a tag this message already had (an edit) or a member's current name.
-- History (p_history true, the backfill): any name a member has had; the message's own notification
-- decides between members first, otherwise a name more than one member has had is `ambiguous`.
create function public.chat_message_tag_scan(p_body text,p_message uuid,p_history boolean)
returns table(tag_key text,tagged_as text,member_id uuid,ambiguous boolean)
language plpgsql stable security invoker set search_path='' as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; best record; seen text[]:='{}'; typed text;
begin
 if p_body is null then return; end if;
 loop
  relative_pos:=strpos(substr(p_body,scan_from),'@'); exit when relative_pos=0;
  at_pos:=scan_from+relative_pos-1; scan_from:=at_pos+1;
  if at_pos>1 and substr(p_body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
  best:=null;
  select c.len,c.member_id,c.prio,c.shared into best from (
   select length(t.tagged_as) len,t.member_id,0 prio,false shared from public.chat_message_tags t
    where not p_history and t.message_id=p_message
     and lower(substr(p_body,at_pos+1,length(t.tagged_as)))=t.tag_key
     and substr(p_body,at_pos+1+length(t.tagged_as),1) !~ '[[:alnum:]_]'
   union all
   select length(m.display_name),m.id,1,false from public.longboard_chat_members m
    where not p_history
     and lower(substr(p_body,at_pos+1,length(m.display_name)))=lower(m.display_name)
     and substr(p_body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]'
   union all
   select length(n.display_name),n.member_id,
    case when exists(select 1 from public.chat_room_mentions r join public.longboard_chat_members mm on mm.user_id=r.account_id
     where r.message_id=p_message and r.category='mention' and mm.id=n.member_id) then -1 else 2 end,
    exists(select 1 from public.chat_member_names o where o.name_key=n.name_key and o.member_id<>n.member_id)
    from public.chat_member_names n
    where p_history
     and lower(substr(p_body,at_pos+1,length(n.display_name)))=n.name_key
     and substr(p_body,at_pos+1+length(n.display_name),1) !~ '[[:alnum:]_]'
  ) c order by c.len desc,c.prio,c.member_id limit 1;
  if best.len is null then continue; end if;
  typed:=substr(p_body,at_pos+1,best.len);
  if lower(typed)=any(seen) then continue; end if;
  seen:=seen||lower(typed);
  tag_key:=lower(typed); tagged_as:=typed;
  if best.prio=2 and best.shared then member_id:=null; ambiguous:=true; else member_id:=best.member_id; ambiguous:=false; end if;
  return next;
 end loop;
end $$;

create function public.record_chat_message_tags() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r record; keys text[]:='{}';
begin
 if tg_op='UPDATE' and new.body is not distinct from old.body then return new; end if;
 for r in select * from public.chat_message_tag_scan(new.body,new.id,false) loop
  if r.member_id is null then continue; end if;
  keys:=keys||r.tag_key;
  insert into public.chat_message_tags(message_id,tag_key,tagged_as,member_id) values(new.id,r.tag_key,r.tagged_as,r.member_id)
  on conflict(message_id,tag_key) do update set tagged_as=excluded.tagged_as,member_id=excluded.member_id
   where (chat_message_tags.tagged_as,chat_message_tags.member_id) is distinct from (excluded.tagged_as,excluded.member_id);
 end loop;
 if tg_op='UPDATE' then delete from public.chat_message_tags where message_id=new.id and not(tag_key=any(keys)); end if;
 return new;
end $$;
-- Same events as chat_room_mention_events, and named to run before it (triggers on one event run
-- in name order), so the notifications below read this message's tags.
create trigger chat_message_tag_events after insert or update of body on public.longboard_chat_messages
 for each row execute function public.record_chat_message_tags();

-- Current definition (20261023200000_chat_whats_new_room.sql) with the people taken from the
-- message's stored tags instead of matching current names again. Rooms, eligibility, blocks and
-- the self rule are unchanged.
CREATE OR REPLACE FUNCTION public.record_chat_room_mentions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare person record; recipients uuid[]:='{}'; recipient uuid;
begin
 -- #302: What's New never alerts anyone, not even for an @name in an admin note.
 if new.room_slug in ('lb-announcements','lb-recordings','ss-announcements','ss-recordings','whats-new') then return new; end if;
 if new.member_id is not null then
  for person in select distinct m.id,m.user_id from chat_message_tags t join longboard_chat_members m on m.id=t.member_id where t.message_id=new.id loop
   if person.id<>new.member_id and public.chat_account_room_recipient_eligible(person.user_id,new.room_slug) and not exists(select 1 from longboard_chat_blocks b where (b.blocker_id=person.id and b.blocked_id=new.member_id) or (b.blocked_id=person.id and b.blocker_id=new.member_id)) then recipients:=array_append(recipients,person.user_id); end if;
  end loop;
 end if;
 delete from chat_room_mentions where message_id=new.id and category='mention' and not(account_id=any(recipients));
 foreach recipient in array recipients loop
  insert into chat_room_mentions(account_id,message_id,room_slug) values(recipient,new.id,new.room_slug) on conflict(account_id,message_id) do nothing;
 end loop;
 return new;
end $function$;

-- Shown messages: each stored tag's member with their current name and picture; plus members by
-- current name (text with no stored tags: DMs, and messages the backfill has not reached or left alone).
-- Messages count only in rooms the reader may open now; at most 60 names and 60 messages.
create function public.chat_tag_lookup(p_actor uuid,p_rooms text[],p_names text[],p_messages uuid[])
returns table(message_id uuid,tag_key text,member_id uuid,display_name text,avatar_path text)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_names),0)>60 or coalesce(cardinality(p_messages),0)>60 then raise exception 'invalid_query'; end if;
 return query
 select null::uuid,lower(m.display_name),m.id,m.display_name,m.avatar_path from public.longboard_chat_members m
  where lower(m.display_name)=any(coalesce(p_names,'{}'))
 union all
 select t.message_id,t.tag_key,m.id,m.display_name,m.avatar_path
  from public.chat_message_tags t
  join public.longboard_chat_messages msg on msg.id=t.message_id
  join public.longboard_chat_members m on m.id=t.member_id
  where t.message_id=any(coalesce(p_messages,'{}')) and msg.room_slug=any(coalesce(p_rooms,'{}'))
   and msg.deleted_at is null and not msg.removed and public.chat_account_has_room(p_actor,msg.room_slug);
end $$;

-- The @ list: one row per member. Current-name matches first, then members found by an earlier
-- name (previous_name says which) that no one else has ever had or has now.
create function public.chat_tag_suggestions(p_query text,p_hidden uuid[],p_limit integer default 10)
returns table(id uuid,display_name text,avatar_path text,previous_name text)
language plpgsql stable security invoker set search_path='' as $$
declare q text;
begin
 if p_query is null or char_length(p_query)>28 or p_limit not between 1 and 20 then raise exception 'invalid_query'; end if;
 q:=replace(replace(replace(lower(p_query),'\','\\'),'_','\_'),'%','\%')||'%';
 return query
 select s.id,s.display_name,s.avatar_path,s.previous_name from (
  select distinct on (m.id) m.id,m.display_name,m.avatar_path,
   case when lower(m.display_name) like q escape '\' then null else n.display_name end previous_name,
   lower(m.display_name) like q escape '\' current_match
  from public.longboard_chat_members m
  left join public.chat_member_names n on n.member_id=m.id and n.name_key like q escape '\' and n.name_key<>lower(m.display_name)
   and not exists(select 1 from public.chat_member_names o where o.name_key=n.name_key and o.member_id<>m.id)
   and not exists(select 1 from public.longboard_chat_members cur where lower(cur.display_name)=n.name_key and cur.id<>m.id)
  where (lower(m.display_name) like q escape '\' or n.member_id is not null)
   and not (m.user_id=any(coalesce(p_hidden,'{}')))
  order by m.id,n.display_name
 ) s order by s.current_match desc,s.display_name,s.id limit p_limit;
end $$;

-- Backfill progress (one row). The cutoff keeps the backfill to messages sent before this
-- migration; later ones were tagged by the trigger.
create table public.chat_tags_backfill (
 id boolean primary key default true check(id),
 cutoff timestamptz not null default now(),
 phase text not null default 'names' check(phase in ('names','tags','done')),
 after_id uuid,
 scanned bigint not null default 0,
 names_added bigint not null default 0,
 messages_tagged bigint not null default 0,
 tags_added bigint not null default 0,
 ambiguous bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.chat_tags_backfill enable row level security;
revoke all on public.chat_tags_backfill from public,anon,authenticated;
grant all on public.chat_tags_backfill to service_role;
insert into public.chat_tags_backfill default values;

-- One batch: up to p_limit messages (by id) of the current phase. Phase 'names' records the name
-- each message was sent under; phase 'tags' then stores the tags of messages with an "@" that have
-- none yet. Returns the progress row; call again until phase is 'done'.
create function public.chat_tags_backfill_step(p_limit integer default 500)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.chat_tags_backfill; last_id uuid; n bigint:=0; added bigint:=0; tagged bigint:=0; tags bigint:=0; amb bigint:=0; msg record; r record; any_tag boolean;
begin
 if p_limit not between 1 and 5000 then raise exception 'invalid_limit'; end if;
 select * into s from public.chat_tags_backfill where id for update;
 if s.phase='done' then return to_jsonb(s); end if;
 if s.phase='names' then
  with batch as (
   select m.id,m.member_id,m.bot_slug,btrim(m.author_label) label from public.longboard_chat_messages m
   where (s.after_id is null or m.id>s.after_id) and m.created_at<s.cutoff order by m.id limit p_limit
  ), ins as (
   insert into public.chat_member_names(member_id,name_key,display_name)
   select distinct on (b.member_id,lower(b.label)) b.member_id,lower(b.label),b.label from batch b
   join public.longboard_chat_members mem on mem.id=b.member_id
   where b.bot_slug is null and char_length(b.label) between 2 and 28
    and lower(b.label) not in ('buddy','longboard','longboard admin')
   on conflict do nothing returning 1
  ) select (select b.id from batch b order by b.id desc limit 1),(select count(*) from batch),(select count(*) from ins) into last_id,n,added;
  update public.chat_tags_backfill set
   phase=case when last_id is null then 'tags' else 'names' end,after_id=last_id,
   scanned=scanned+n,names_added=names_added+added,updated_at=now()
  where id returning * into s;
  return to_jsonb(s);
 end if;
 for msg in
  select m.id,m.body from public.longboard_chat_messages m
  where (s.after_id is null or m.id>s.after_id) and m.created_at<s.cutoff order by m.id limit p_limit
 loop
  last_id:=msg.id; n:=n+1;
  if strpos(msg.body,'@')=0 or exists(select 1 from public.chat_message_tags t where t.message_id=msg.id) then continue; end if;
  any_tag:=false;
  for r in select * from public.chat_message_tag_scan(msg.body,msg.id,true) loop
   if r.ambiguous then amb:=amb+1; continue; end if;
   insert into public.chat_message_tags(message_id,tag_key,tagged_as,member_id) values(msg.id,r.tag_key,r.tagged_as,r.member_id) on conflict do nothing;
   if found then tags:=tags+1; any_tag:=true; end if;
  end loop;
  if any_tag then tagged:=tagged+1; end if;
 end loop;
 update public.chat_tags_backfill set
  phase=case when last_id is null then 'done' else 'tags' end,after_id=last_id,
  scanned=scanned+n,messages_tagged=messages_tagged+tagged,tags_added=tags_added+tags,ambiguous=ambiguous+amb,updated_at=now()
 where id returning * into s;
 return to_jsonb(s);
end $$;

revoke all on function public.remember_chat_member_name(),public.chat_message_tag_scan(text,uuid,boolean),public.record_chat_message_tags(),
 public.chat_tag_lookup(uuid,text[],text[],uuid[]),public.chat_tag_suggestions(text,uuid[],integer),public.chat_tags_backfill_step(integer)
 from public,anon,authenticated;
grant execute on function public.remember_chat_member_name(),public.chat_message_tag_scan(text,uuid,boolean),public.record_chat_message_tags(),
 public.chat_tag_lookup(uuid,text[],text[],uuid[]),public.chat_tag_suggestions(text,uuid[],integer),public.chat_tags_backfill_step(integer)
 to service_role;
