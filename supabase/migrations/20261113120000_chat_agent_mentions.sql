-- #455 Agents: mention alerts. An agent fetches, with its own token, only the room posts that
-- @mention it since a cursor (GET /api/chat/agents/mentions), instead of re-reading rooms.
--
-- Recorded at post time, not searched later:
--  * chat_agent_mentions: one row per (agent, message) that @names the agent, with a growing seq
--    that is the agent's cursor. Filled by a trigger when a room message is sent or its text is
--    edited (an edit that adds a mention records it then, one that removes it deletes the row).
--    Agents are few (3 per developer), so the scan is cheap and only runs on text with an "@".
--    A poll is then one index range read on (agent_id, seq), however busy the rooms are, instead
--    of a text search over every new message in every room the agent may read.
--  * Matching (chat_agent_mention_scan) uses the agent's name at that moment, case-insensitive,
--    with the same edges as member @tags (record_chat_room_mentions / chat_message_tag_scan): the
--    "@" may not follow a letter, digit, "_" or "@", and the name may not run on into a letter,
--    digit or "_". Names with spaces work ("@Desk Helper"). "@Luke" matches Luke, "@Lukewarm"
--    does not. At each "@" the longest name wins, members included: "@Luke Smith" is a tag of the
--    member Luke Smith, not of the agent Luke. An agent's own posts are never recorded.
--  * chat_agent_mentions_since (read): the agent's rows after the cursor, oldest first, kept only
--    when the message is in a room the agent may read now (the rooms the app passes, which already
--    are the owner's rooms narrowed by the agent's permissions, intersected again here with
--    chat_agent_effective: the ceiling and the owner's settings), not deleted or removed, and not
--    the agent's own. The next cursor moves past every row looked at, kept or not, so skipped
--    rows are never read twice. Rows younger than 2 seconds wait for the next poll, so a send
--    that commits a moment late can't be jumped over. Without a cursor: the last 24 hours.
--  * Backfill: messages with an "@" sent since the first agent was made (agents went live
--    2026-11-12; a few days of messages, at most 7) are scanned once here, so mentions made
--    before this migration can be fetched.
--
-- Security invoker throughout, search_path '', service_role only. No existing function changes.
-- Additive: the running app never reads the new table; the new route answers
-- mentions_unavailable until this is applied.
-- Rollback: supabase/rollbacks/20261113120000_chat_agent_mentions.down.sql

create table public.chat_agent_mentions(
 seq bigint generated always as identity primary key,
 agent_id uuid not null references public.chat_agents(id) on delete cascade,
 message_id uuid not null references public.longboard_chat_messages(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 unique(agent_id,message_id)
);
create index chat_agent_mentions_agent_seq on public.chat_agent_mentions(agent_id,seq);
create index chat_agent_mentions_message on public.chat_agent_mentions(message_id);
alter table public.chat_agent_mentions enable row level security;
revoke all on public.chat_agent_mentions from public,anon,authenticated;
grant select,insert,update,delete on public.chat_agent_mentions to service_role;

-- The agents a message body @names (see the header). Mirrored in lib/chatAgentMentions.ts.
create function public.chat_agent_mention_scan(p_body text) returns uuid[]
language plpgsql stable security invoker set search_path='' as $$
declare at_pos integer; scan_from integer:=1; relative_pos integer; best record; hits uuid[]:='{}';
begin
 if p_body is null or strpos(p_body,'@')=0 then return hits; end if;
 loop
  relative_pos:=strpos(substr(p_body,scan_from),'@'); exit when relative_pos=0;
  at_pos:=scan_from+relative_pos-1; scan_from:=at_pos+1;
  if at_pos>1 and substr(p_body,at_pos-1,1) ~ '[[:alnum:]_@]' then continue; end if;
  best:=null;
  select a.id,length(a.name) len into best from public.chat_agents a
   where a.deleted_at is null
    and lower(substr(p_body,at_pos+1,length(a.name)))=lower(a.name)
    and substr(p_body,at_pos+1+length(a.name),1) !~ '[[:alnum:]_]'
   order by length(a.name) desc,a.id limit 1;
  if best.id is null then continue; end if;
  -- A longer member name at the same "@" is that member's tag.
  if exists(select 1 from public.longboard_chat_members m
    where length(m.display_name)>best.len
     and lower(substr(p_body,at_pos+1,length(m.display_name)))=lower(m.display_name)
     and substr(p_body,at_pos+1+length(m.display_name),1) !~ '[[:alnum:]_]') then continue; end if;
  if not best.id=any(hits) then hits:=hits||best.id; end if;
 end loop;
 return hits;
end $$;

create function public.record_chat_agent_mentions() returns trigger
language plpgsql security invoker set search_path='' as $$
declare hits uuid[];
begin
 if tg_op='UPDATE' and new.body is not distinct from old.body then return new; end if;
 if tg_op='INSERT' and strpos(coalesce(new.body,''),'@')=0 then return new; end if;
 hits:=public.chat_agent_mention_scan(new.body);
 if new.agent_id is not null then hits:=array_remove(hits,new.agent_id); end if;
 if tg_op='UPDATE' then
  delete from public.chat_agent_mentions where message_id=new.id and not (agent_id=any(hits));
 end if;
 if cardinality(hits)>0 then
  insert into public.chat_agent_mentions(agent_id,message_id) select h,new.id from unnest(hits) h
  on conflict(agent_id,message_id) do nothing;
 end if;
 return new;
end $$;
create trigger chat_agent_mention_events after insert or update of body on public.longboard_chat_messages
 for each row execute function public.record_chat_agent_mentions();

-- One page of an agent's mentions after p_after (null: the last 24 hours), at most p_limit rows
-- looked at. Returns {mentions, cursor, more}; more is true when the page was full (call again
-- with the cursor).
create function public.chat_agent_mentions_since(p_agent uuid,p_rooms text[],p_after bigint,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rooms text[]; last_seq bigint; looked integer; found jsonb; settled timestamptz:=clock_timestamp()-interval '2 seconds';
begin
 if p_agent is null or p_limit is null or p_limit not between 1 and 100 or p_after<0 then raise exception 'invalid_query'; end if;
 select coalesce(array_agg(x),'{}') into rooms from unnest(coalesce(p_rooms,'{}')) x
  where x=any(array(select jsonb_array_elements_text(public.chat_agent_effective(p_agent)->'readRooms')));
 with page as (
  select k.seq,k.message_id from public.chat_agent_mentions k
  where k.agent_id=p_agent and k.seq>coalesce(p_after,0) and k.created_at<settled
   and (p_after is not null or k.created_at>=now()-interval '1 day')
  order by k.seq limit p_limit
 )
 select max(p.seq),count(*)::integer,
  coalesce(jsonb_agg(jsonb_build_object(
    'seq',p.seq,'id',msg.id,'room',msg.room_slug,
    'author',case when msg.agent_id is null and mem.display_name is not null then mem.display_name else msg.author_label end,
    'authorAgentId',msg.agent_id,
    'body',msg.body,'replyTo',msg.reply_to_id,'createdAt',msg.created_at
   ) order by p.seq) filter (where msg.id is not null),'[]'::jsonb)
 into last_seq,looked,found
 from page p
 left join public.longboard_chat_messages msg on msg.id=p.message_id and msg.room_slug=any(rooms)
  and msg.deleted_at is null and not msg.removed and msg.agent_id is distinct from p_agent
 left join public.longboard_chat_members mem on mem.id=msg.member_id;
 if last_seq is null then
  last_seq:=coalesce(p_after,(select max(k.seq) from public.chat_agent_mentions k where k.agent_id=p_agent and k.created_at<settled),0);
 end if;
 return jsonb_build_object('mentions',found,'cursor',last_seq,'more',looked=p_limit);
end $$;

revoke all on function public.chat_agent_mention_scan(text),public.record_chat_agent_mentions(),
 public.chat_agent_mentions_since(uuid,text[],bigint,integer) from public,anon,authenticated;
grant execute on function public.chat_agent_mention_scan(text),public.chat_agent_mentions_since(uuid,text[],bigint,integer) to service_role;

-- Backfill (see the header): a few days of messages at most.
insert into public.chat_agent_mentions(agent_id,message_id)
select h,m.id from public.longboard_chat_messages m
 cross join lateral unnest(public.chat_agent_mention_scan(m.body)) h
where strpos(m.body,'@')>0
 and m.created_at>=greatest(now()-interval '7 days',(select min(a.created_at) from public.chat_agents a))
 and h is distinct from m.agent_id
order by m.created_at,m.id
on conflict(agent_id,message_id) do nothing;
