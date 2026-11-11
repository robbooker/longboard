-- #444 One chat profile per person: merge linked Longboard + ShortScout profiles.
--
-- Before: a member who signed in with ShortScout first and later connected their Longboard
-- account (chat_shortscout_membership_links) kept two chat profiles, one per account, on purpose
-- ("profiles and inboxes stay separate"): two names in the @ list, two inboxes, their history
-- split in two. A ShortScout sign-in always landed on the ShortScout account, and a ShortScout
-- account without a profile was asked for a name, which made a second profile.
--
-- After:
--  * chat_merge_linked_profile(lb_account) merges ONE linked pair per call (one transaction):
--      merge  - both profiles exist: the Longboard profile row (its member id) is kept and every
--               row that points at the ShortScout profile's member id moves onto it. The name and
--               picture kept are those of the profile the person posted from most recently (room
--               or DM message); if neither ever posted, the Longboard ones. When the ShortScout
--               ones win, the two rows swap names and pictures (the retired row's name is freed
--               first, all in the same transaction), and both names stay in chat_member_names;
--      adopt  - only the ShortScout profile exists: it moves to the Longboard account as it is;
--      attach - only the Longboard profile exists (or none): only the ShortScout account's rows.
--    In every mode the ShortScout account's personal rows (notifications, read positions, push
--    devices, pins, favorites, settings) and its live chat sign-ins move to the Longboard account.
--    chat_merge_next_linked_profile() does the next pair not merged yet (null when none are left).
--  * Member-id references are found in pg_catalog at run time: every foreign key to
--    longboard_chat_members(id) or longboard_chat_guests(id) (messages and reactions keep the
--    member id in guest_id too). Account references (foreign keys to chat_accounts) are listed
--    below as moved or kept; an unlisted one stops the merge, so a new table gets a decision.
--  * Collisions keep one row, the Longboard profile's: a duplicate (same reaction, same tag key,
--    same name, same pin, ...) is removed into the log. Kept rows take the better of the two
--    where it matters: a read position takes the furthest one, a like or reaction stays on if
--    either had it on. A single-choice poll both profiles voted in keeps the Longboard vote.
--    A message client id both profiles used gets a fresh one. Blocks between the two profiles
--    are removed. Direct messages: a conversation between the two profiles is removed into the
--    log (with its messages); when both profiles talked to the same person, the ShortScout
--    conversation's messages, files and pins move into the Longboard one (read positions take the
--    furthest, an accepted request stays accepted) and the empty conversation is removed.
--  * Reversible: every changed row is written to chat_profile_merge_log (table, the row after the
--    change, the column and its old value; a removed row is kept whole).
--    chat_unmerge_linked_profile(merge id) puts every row back, newest change first. The retired
--    profile row is never deleted: it is marked (merged_into, merged_at) and given an empty
--    placeholder account, so it has no rooms and drops out of every member list, and the
--    ShortScout account has no profile any more.
--  * The merge runs with triggers off for its own transaction (session_replication_role =
--    replica, set inside the function), so no guard re-checks old rows, no notification or push
--    is created, nothing cascades behind the log's back. The bell counters are recomputed for
--    both accounts at the end.
--  * Sign-in: a ShortScout sign-in for a linked identity whose ShortScout account has no profile
--    (merged, or never had one) lands on the Longboard account and its profile instead of asking
--    for a new name. That sign-in is marked shortscout_only, and chat_session_request_context
--    then reports no Longboard access, Boardroom or admin role for it: it opens exactly the rooms
--    the ShortScout membership opens, as before. A Longboard sign-in is unchanged (it already got
--    the ShortScout rooms through the link). A new profile can no longer be created on the
--    ShortScout account of an active link (chat_member_link_guard).
--  * The @ list, tag lookups and new tags skip retired profiles; the kept profile is found by the
--    retired profile's names too (they move into its name history).
--
-- Nothing is merged by this migration. Run the read-only report first
-- (scripts/sql/chat-merge-linked-profiles-report.sql), then one pair per call:
--   select public.chat_merge_next_linked_profile();      -- repeat until it returns null
-- Undo one: select public.chat_unmerge_linked_profile(<merge id>);
-- Rollback (after undoing every merge): supabase/rollbacks/20261111170000_chat_merge_linked_profiles.down.sql

set lock_timeout = '5s';

-- ---- State ----
alter table public.longboard_chat_members add column if not exists merged_into uuid, add column if not exists merged_at timestamptz;
alter table public.chat_sessions add column if not exists shortscout_only boolean not null default false;

create table public.chat_profile_merges (
 id bigint generated always as identity primary key,
 mode text not null check (mode in ('merge','adopt','attach')),
 lb_account_id uuid not null,
 source_account_id uuid not null,
 kept_member_id uuid,
 retired_member_id uuid,
 kept_name text,
 retired_name text,
 placeholder_account_id uuid,
 name_from text check (name_from in ('longboard','shortscout')),
 rows_moved integer not null default 0,
 rows_removed integer not null default 0,
 runs integer not null default 1,
 detail jsonb not null default '{}',
 merged_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 undone_at timestamptz,
 undo_skipped integer
);
create unique index chat_profile_merges_active_lb on public.chat_profile_merges(lb_account_id) where undone_at is null;
create unique index chat_profile_merges_active_source on public.chat_profile_merges(source_account_id) where undone_at is null;

create table public.chat_profile_merge_log (
 id bigint generated always as identity primary key,
 merge_id bigint not null references public.chat_profile_merges(id),
 table_name text not null,
 op text not null check (op in ('update','delete','insert')),
 column_name text,
 old_value jsonb,
 new_value jsonb,
 row_data jsonb not null,
 created_at timestamptz not null default now(),
 check ((op='update')=(column_name is not null))
);
create index chat_profile_merge_log_merge on public.chat_profile_merge_log(merge_id, id);

alter table public.chat_profile_merges enable row level security;
alter table public.chat_profile_merge_log enable row level security;
revoke all on public.chat_profile_merges, public.chat_profile_merge_log from public, anon, authenticated, service_role;

-- ---- Row helpers (logged) ----

-- The columns that find a row again: the primary key, or every stored column when there is none.
create function public.chat_merge_key_columns(p_table regclass) returns text[]
language sql stable security invoker set search_path='' as $$
 select coalesce(
  (select array_agg(a.attname::text order by k.ord) from pg_index i
    cross join lateral unnest(i.indkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
    where i.indrelid=p_table and i.indisprimary),
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
    where a.attrelid=p_table and a.attnum>0 and not a.attisdropped and a.attgenerated=''));
$$;

-- Removes the rows of p_table matching p_where into the log, children first (foreign keys that
-- cascade are followed; ones that set null are set to null, logged). Returns the rows removed.
create function public.chat_merge_delete(p_merge bigint, p_table regclass, p_where text) returns integer
language plpgsql security invoker set search_path='' as $$
declare fk record; n integer:=0; c integer;
begin
 for fk in
  select c.conrelid::regclass child, ca.attname::text child_col, pa.attname::text parent_col, c.confdeltype
  from pg_constraint c
  join pg_attribute ca on ca.attrelid=c.conrelid and ca.attnum=c.conkey[1]
  join pg_attribute pa on pa.attrelid=c.confrelid and pa.attnum=c.confkey[1]
  where c.contype='f' and c.confrelid=p_table and c.conrelid<>p_table and cardinality(c.conkey)=1
  order by 1,2
 loop
  if fk.confdeltype='c' then
   n:=n+public.chat_merge_delete(p_merge,fk.child,format('%I in (select %I from %s where %s)',fk.child_col,fk.parent_col,p_table,p_where));
  elsif fk.confdeltype='n' then
   perform public.chat_merge_set(p_merge,fk.child,fk.child_col,'null'::jsonb,format('%I in (select %I from %s where %s)',fk.child_col,fk.parent_col,p_table,p_where));
  else
   execute format('select count(*) from %s where %I in (select %I from %s where %s)',fk.child,fk.child_col,fk.parent_col,p_table,p_where) into c;
   if c>0 then raise exception 'merge_delete_blocked: %.%',fk.child,fk.child_col; end if;
  end if;
 end loop;
 execute format('with d as (delete from %s t where %s returning to_jsonb(t) j)
  insert into public.chat_profile_merge_log(merge_id,table_name,op,row_data) select $1,%L,''delete'',j from d',p_table,p_where,p_table::text) using p_merge;
 get diagnostics c = row_count;
 return n+c;
end $$;

-- Sets one column on the rows matching p_where, logging each row. Returns the rows changed.
create function public.chat_merge_set(p_merge bigint, p_table regclass, p_column text, p_value jsonb, p_where text) returns integer
language plpgsql security invoker set search_path='' as $$
declare c integer;
begin
 execute format('with o as (select ctid, %1$I old from %2$s where %3$s for update),
  u as (update %2$s t set %1$I=(jsonb_populate_record(null::%2$s,$2)).%1$I from o where t.ctid=o.ctid
   and t.%1$I is distinct from (jsonb_populate_record(null::%2$s,$2)).%1$I returning to_jsonb(o.old) old, to_jsonb(t) j)
  insert into public.chat_profile_merge_log(merge_id,table_name,op,column_name,old_value,new_value,row_data)
  select $1,%4$L,''update'',%5$L,u.old,u.j->%5$L,u.j from u',p_column,p_table,p_where,p_table::text,p_column)
 using p_merge, jsonb_build_object(p_column,p_value);
 get diagnostics c = row_count;
 return c;
end $$;

-- Inserts one row (as jsonb), logged so undo removes it; nothing when it already exists.
create function public.chat_merge_insert(p_merge bigint, p_table regclass, p_row jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare c integer; cols text;
begin
 select string_agg(quote_ident(k),',') into cols from jsonb_object_keys(p_row) k;
 execute format('with i as (insert into %1$s(%2$s) select %2$s from jsonb_populate_record(null::%1$s,$2) on conflict do nothing returning to_jsonb(%1$s.*) j)
  insert into public.chat_profile_merge_log(merge_id,table_name,op,row_data) select $1,%3$L,''insert'',j from i',p_table,cols,p_table::text)
 using p_merge,p_row;
 get diagnostics c = row_count;
 return c;
end $$;

-- Moves p_column from p_from to p_to. When that would duplicate a row the kept side already has
-- (a unique key), that one row is removed into the log instead. Returns {moved, removed}.
create function public.chat_merge_move(p_merge bigint, p_table regclass, p_column text, p_from uuid, p_to uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare moved integer:=0; removed integer:=0; r record;
begin
 begin
  moved:=public.chat_merge_set(p_merge,p_table,p_column,to_jsonb(p_to),format('%I=%L',p_column,p_from));
  return jsonb_build_object('moved',moved,'removed',0);
 exception when unique_violation then
  moved:=0; -- the whole statement (and its log rows) rolled back; go row by row
 end;
 for r in execute format('select ctid from %s where %I=$1 for update',p_table,p_column) using p_from loop
  begin
   moved:=moved+public.chat_merge_set(p_merge,p_table,p_column,to_jsonb(p_to),format('ctid=%L',r.ctid));
  exception when unique_violation then
   removed:=removed+public.chat_merge_delete(p_merge,p_table,format('ctid=%L',r.ctid));
  end;
 end loop;
 return jsonb_build_object('moved',moved,'removed',removed);
end $$;

-- ---- What points at a profile or an account ----

-- Every member-id column (foreign keys to the member or guest id), found at run time.
create function public.chat_merge_member_columns() returns table(table_name regclass, column_name text)
language sql stable security invoker set search_path='' as $$
 select c.conrelid::regclass, a.attname::text
 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.contype='f' and cardinality(c.conkey)=1
  and c.confrelid in ('public.longboard_chat_members'::regclass,'public.longboard_chat_guests'::regclass)
  and c.conrelid not in ('public.longboard_chat_members'::regclass,'public.longboard_chat_guests'::regclass)
 group by 1,2 order by 1::text,2;
$$;

-- Account-id columns: 'move' to the Longboard account, or 'keep' on the ShortScout account.
create function public.chat_merge_account_columns() returns table(table_name regclass, column_name text, action text)
language plpgsql stable security invoker set search_path='' as $$
declare r record; decided text;
begin
 for r in
  select c.conrelid::regclass t, a.attname::text col
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and cardinality(c.conkey)=1 and c.confrelid='public.chat_accounts'::regclass
  group by 1,2 order by 1::text,2
 loop
  decided:=case regexp_replace(r.t::text,'^public\.','')||'.'||r.col
   -- The person's own things: notifications, read positions, devices, pins, settings.
   when 'chat_room_mentions.account_id' then 'move'
   when 'chat_room_reads.account_id' then 'move'
   when 'chat_reaction_notifications.account_id' then 'move'
   when 'chat_favorites.account_id' then 'move'
   when 'chat_conversation_pins.account_id' then 'move'
   when 'chat_room_notification_levels.account_id' then 'move'
   when 'chat_push_subscriptions.account_id' then 'move'
   when 'chat_activity_preferences.account_id' then 'move'
   when 'chat_card_layouts.account_id' then 'move'
   when 'chat_summary_requests.account_id' then 'move'
   when 'chat_summary_deliveries.account_id' then 'move'
   when 'chat_room_message_pins.pinned_by' then 'move'
   when 'chat_feature_notifications.account_id' then 'move'
   when 'chat_feature_notification_mutes.account_id' then 'move'
   when 'chat_feature_notification_preferences.account_id' then 'move'
   when 'reader_progress.account_id' then 'move'
   -- Moved by the merge itself (sign-ins, the profile row) or worked out again (bell counters).
   when 'chat_sessions.account_id' then 'special'
   when 'longboard_chat_members.user_id' then 'special'
   when 'chat_activity_counters.account_id' then 'special'
   -- Stay with the ShortScout account: its identity and link, access grants and audit history.
   when 'chat_provider_identities.account_id' then 'keep'
   when 'chat_shortscout_membership_links.lb_account_id' then 'keep'
   when 'chat_shortscout_membership_links.source_account_id' then 'keep'
   when 'chat_bot_accounts.account_id' then 'keep'
   when 'chat_api_tokens.account_id' then 'keep'
   when 'chat_api_access.account_id' then 'keep'
   when 'chat_feature_members.account_id' then 'keep'
   when 'chat_feature_requests.approved_by' then 'keep'
   when 'chat_feature_requests.archived_by' then 'keep'
   when 'chat_feature_requests.created_by' then 'keep'
   when 'chat_feature_messages.author_id' then 'keep'
   when 'chat_feature_releases.approved_by' then 'keep'
   when 'chat_message_actions.actor_id' then 'keep'
   when 'longboard_chat_search_budget.user_id' then 'keep'
   when 'member_people.chat_account_id' then 'keep'
   when 'reader_books.created_by' then 'keep'
   else null end;
  if decided is null then raise exception 'merge_unclassified_account_column: %.%',r.t,r.col; end if;
  table_name:=r.t; column_name:=r.col; action:=decided; return next;
 end loop;
end $$;

-- ---- The merge ----
create function public.chat_merge_linked_profile(p_lb_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.chat_shortscout_membership_links; m public.chat_profile_merges; kept public.longboard_chat_members;
 retired public.longboard_chat_members; v_mode text; ss uuid; k uuid; r uuid; col record; res jsonb;
 moved integer:=0; removed integer:=0; v_detail jsonb:='{}'; c record; other uuid; target public.longboard_chat_conversations; n integer;
 rerun boolean:=false; placeholder uuid; k_last timestamptz; r_last timestamptz; take_retired boolean:=false; k_name text; k_avatar text;
begin
 set local lock_timeout = '5s';
 perform pg_advisory_xact_lock(hashtextextended('chat-profile-merge:'||p_lb_account::text,0));
 select * into l from public.chat_shortscout_membership_links where lb_account_id=p_lb_account for update;
 if not found or l.revoked_at is not null then raise exception 'merge_link_not_active'; end if;
 if not exists(select 1 from public.chat_accounts a join public.profiles p on p.id=a.longboard_user_id where a.id=l.lb_account_id and a.id=a.longboard_user_id)
  or not exists(select 1 from public.chat_accounts where id=l.source_account_id and longboard_user_id is null)
 then raise exception 'merge_accounts_invalid'; end if;
 if exists(select 1 from public.chat_bot_accounts where account_id in (l.lb_account_id,l.source_account_id)) then raise exception 'merge_bot_account'; end if;
 ss:=l.source_account_id;
 select * into m from public.chat_profile_merges where lb_account_id=p_lb_account and undone_at is null for update;
 if found then
  rerun:=true; v_mode:=m.mode; k:=m.kept_member_id; r:=m.retired_member_id;
 else
  select * into kept from public.longboard_chat_members where user_id=l.lb_account_id for update;
  select * into retired from public.longboard_chat_members where user_id=ss for update;
  if kept.merged_into is not null then raise exception 'merge_kept_profile_retired'; end if;
  v_mode:=case when kept.id is not null and retired.id is not null then 'merge' when retired.id is not null then 'adopt' else 'attach' end;
  k:=coalesce(kept.id,retired.id); r:=case when v_mode='merge' then retired.id end;
  insert into public.chat_profile_merges(mode,lb_account_id,source_account_id,kept_member_id,retired_member_id,kept_name,retired_name)
  values(v_mode,l.lb_account_id,ss,k,r,coalesce(kept.display_name,retired.display_name),case when v_mode='merge' then retired.display_name end)
  returning * into m;
 end if;
 if r is not null then perform 1 from public.longboard_chat_members where id in (k,r) for update; end if;
 if v_mode='merge' and not rerun then
  -- Which name and picture stay: the profile posted from most recently (before anything moves).
  k_last:=greatest((select max(created_at) from public.longboard_chat_messages where member_id=k),
   (select max(created_at) from public.longboard_chat_direct_messages where sender_id=k));
  r_last:=greatest((select max(created_at) from public.longboard_chat_messages where member_id=r),
   (select max(created_at) from public.longboard_chat_direct_messages where sender_id=r));
  take_retired:=r_last is not null and (k_last is null or r_last>k_last);
  update public.chat_profile_merges set name_from=case when take_retired then 'shortscout' else 'longboard' end,
   kept_name=case when take_retired then retired.display_name else kept.display_name end,
   retired_name=case when take_retired then kept.display_name else retired.display_name end
  where id=m.id returning * into m;
 end if;

 -- Triggers off for this transaction only: no guard, notification, push or cascade on old rows.
 set local session_replication_role = replica;

 if v_mode='adopt' and not rerun then
  -- The ShortScout profile is the only one: it moves to the Longboard account as it is.
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_members','user_id',to_jsonb(l.lb_account_id),format('id=%L',k));
 end if;

 if r is not null then
  -- -- Collisions that need more than "keep the Longboard row" --
  -- Blocks between the two profiles.
  removed:=removed+public.chat_merge_delete(m.id,'public.longboard_chat_blocks',format('(blocker_id=%L and blocked_id=%L) or (blocker_id=%2$L and blocked_id=%1$L)',k,r));
  -- A like or reaction stays on if either profile had it on.
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_reactions','active','true'::jsonb,
   format('guest_id=%L and not active and message_id in (select message_id from public.longboard_chat_reactions where guest_id=%L and active)',k,r));
  moved:=moved+public.chat_merge_set(m.id,'public.chat_message_reaction_choices','active','true'::jsonb,
   format('member_id=%L and not active and exists(select 1 from public.chat_message_reaction_choices o where o.member_id=%L and o.active and o.emoji=chat_message_reaction_choices.emoji
     and o.room_message_id is not distinct from chat_message_reaction_choices.room_message_id and o.dm_message_id is not distinct from chat_message_reaction_choices.dm_message_id)',k,r));
  -- A single-choice poll both voted in keeps the Longboard vote.
  removed:=removed+public.chat_merge_delete(m.id,'public.chat_poll_votes',
   format('member_id=%L and poll_id in (select v.poll_id from public.chat_poll_votes v join public.chat_polls p on p.id=v.poll_id where v.member_id=%L and not p.multi)',r,k));
  -- A client id both profiles used (for retries) gets a fresh one rather than losing a message.
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_messages','client_id',to_jsonb(gen_random_uuid()),
   format('member_id=%L and client_id in (select client_id from public.longboard_chat_messages where member_id=%L and client_id is not null)',r,k));
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_direct_messages','client_id',to_jsonb(gen_random_uuid()),
   format('sender_id=%L and client_id in (select client_id from public.longboard_chat_direct_messages where sender_id=%L)',r,k));

  -- -- Direct messages --
  for c in select * from public.longboard_chat_conversations where r in (requester_id,recipient_id) order by created_at,id loop
   other:=case when c.requester_id=r then c.recipient_id else c.requester_id end;
   if other=k then
    -- A conversation between the two profiles would be with oneself: removed (kept in the log).
    removed:=removed+public.chat_merge_delete(m.id,'public.longboard_chat_conversations',format('id=%L',c.id));
    continue;
   end if;
   select * into target from public.longboard_chat_conversations
    where least(requester_id,recipient_id)=least(k,other) and greatest(requester_id,recipient_id)=greatest(k,other) for update;
   if target.id is null then continue; end if; -- moved with the other columns below
   -- Both profiles talked to this person: one conversation, the Longboard one.
   for col in select x.table_name, x.column_name from (values
     ('public.longboard_chat_direct_messages'::regclass,'conversation_id'),('public.chat_attachments'::regclass,'conversation_id'),
     ('public.chat_clarity_drafts'::regclass,'conversation_id'),('public.chat_favorites'::regclass,'conversation_id'),
     ('public.chat_conversation_pins'::regclass,'conversation_id'),('public.longboard_chat_reports'::regclass,'conversation_id')) x(table_name,column_name)
   loop
    res:=public.chat_merge_move(m.id,col.table_name,col.column_name,c.id,target.id);
    moved:=moved+(res->>'moved')::int; removed:=removed+(res->>'removed')::int;
   end loop;
   -- Read positions take the furthest; an accepted request stays accepted.
   moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_conversations',
    case when target.requester_id=k then 'requester_read_seq' else 'recipient_read_seq' end,
    to_jsonb(greatest(case when target.requester_id=k then target.requester_read_seq else target.recipient_read_seq end,case when c.requester_id=r then c.requester_read_seq else c.recipient_read_seq end)),
    format('id=%L',target.id));
   moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_conversations',
    case when target.requester_id=other then 'requester_read_seq' else 'recipient_read_seq' end,
    to_jsonb(greatest(case when target.requester_id=other then target.requester_read_seq else target.recipient_read_seq end,case when c.requester_id=other then c.requester_read_seq else c.recipient_read_seq end)),
    format('id=%L',target.id));
   if c.status='accepted' or (c.status='pending' and target.status='declined') then
    moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_conversations','status',to_jsonb(c.status),format('id=%L',target.id));
   end if;
   moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_conversations','updated_at',to_jsonb(greatest(c.updated_at,target.updated_at)),format('id=%L',target.id));
   removed:=removed+public.chat_merge_delete(m.id,'public.longboard_chat_conversations',format('id=%L',c.id));
  end loop;

  -- -- Every member-id column --
  for col in select * from public.chat_merge_member_columns() loop
   res:=public.chat_merge_move(m.id,col.table_name,col.column_name,r,k);
   if (res->>'moved')::int+(res->>'removed')::int>0 then v_detail:=v_detail||jsonb_build_object(col.table_name::text||'.'||col.column_name,res); end if;
   moved:=moved+(res->>'moved')::int; removed:=removed+(res->>'removed')::int;
  end loop;
 end if;

 -- -- The ShortScout account's own rows --
 -- Read positions take the furthest of the two.
 for c in select k2.room_slug, greatest(k2.through_seq,s2.through_seq) best from public.chat_room_reads k2
   join public.chat_room_reads s2 on s2.room_slug=k2.room_slug and s2.account_id=ss where k2.account_id=l.lb_account_id and s2.through_seq>k2.through_seq loop
  moved:=moved+public.chat_merge_set(m.id,'public.chat_room_reads','through_seq',to_jsonb(c.best),format('account_id=%L and room_slug=%L',l.lb_account_id,c.room_slug));
 end loop;
 for col in select * from public.chat_merge_account_columns() where action='move' loop
  res:=public.chat_merge_move(m.id,col.table_name,col.column_name,ss,l.lb_account_id);
  if (res->>'moved')::int+(res->>'removed')::int>0 then v_detail:=v_detail||jsonb_build_object(col.table_name::text||'.'||col.column_name,res); end if;
  moved:=moved+(res->>'moved')::int; removed:=removed+(res->>'removed')::int;
 end loop;
 if r is not null then
  -- A reaction alert for one's own message, now that both sides are the same person.
  removed:=removed+public.chat_merge_delete(m.id,'public.chat_reaction_notifications',format('account_id=%L and reactor_member_id=%L',l.lb_account_id,k));
 end if;
 -- Live ShortScout sign-ins carry on as the Longboard account, with ShortScout access only.
 n:=public.chat_merge_set(m.id,'public.chat_sessions','shortscout_only','true'::jsonb,format('account_id=%L and revoked_at is null and expires_at>now()',ss));
 n:=n+public.chat_merge_set(m.id,'public.chat_sessions','account_id',to_jsonb(l.lb_account_id),format('account_id=%L and revoked_at is null and expires_at>now()',ss));
 if n>0 then v_detail:=v_detail||jsonb_build_object('chat_sessions',n/2); end if;
 moved:=moved+n;

 -- The retired profile stays, marked, with an empty placeholder account (no rooms, no lists).
 if r is not null and not rerun then
  insert into public.chat_accounts default values returning id into placeholder;
  update public.chat_profile_merges set placeholder_account_id=placeholder where id=m.id;
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_members','merged_into',to_jsonb(k),format('id=%L',r));
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_members','merged_at',to_jsonb(now()),format('id=%L',r));
  moved:=moved+public.chat_merge_set(m.id,'public.longboard_chat_members','user_id',to_jsonb(placeholder),format('id=%L',r));
  if take_retired then
   -- The ShortScout name and picture were used last: the two rows swap them. The retired row's
   -- name is freed first (a temporary name), so the one-name-per-member rule holds at every step.
   k_name:=kept.display_name; k_avatar:=kept.avatar_path;
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','display_name',to_jsonb(left('merged '||r::text,28)),format('id=%L',r));
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','display_name',to_jsonb(retired.display_name),format('id=%L',k));
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','avatar_path',coalesce(to_jsonb(retired.avatar_path),'null'::jsonb),format('id=%L',k));
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','name_revision',to_jsonb(coalesce(kept.name_revision,0)+1),format('id=%L',k));
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','display_name',to_jsonb(k_name),format('id=%L',r));
   perform public.chat_merge_set(m.id,'public.longboard_chat_members','avatar_path',coalesce(to_jsonb(k_avatar),'null'::jsonb),format('id=%L',r));
  end if;
  -- Both names in the kept profile's history (#439), so old tags and "was ..." still find them.
  perform public.chat_merge_insert(m.id,'public.chat_member_names',jsonb_build_object('member_id',k,'name_key',lower(nm),'display_name',nm))
  from unnest(array[kept.display_name,retired.display_name]) nm where to_regclass('public.chat_member_names') is not null;
 end if;

 set local session_replication_role = origin;
 -- The bell's counters, worked out again for both accounts.
 if to_regprocedure('public.chat_activity_counter_refresh_account(uuid,text)') is not null then
  perform public.chat_activity_counter_refresh_account(l.lb_account_id,null);
  perform public.chat_activity_counter_refresh_account(ss,null);
 end if;
 update public.chat_profile_merges set rows_moved=rows_moved+moved, rows_removed=rows_removed+removed,
  runs=runs+case when rerun then 1 else 0 end, detail=chat_profile_merges.detail||v_detail, updated_at=now()
 where id=m.id returning * into m;
 return jsonb_build_object('mergeId',m.id,'mode',m.mode,'kept',m.kept_name,'retired',m.retired_name,'rerun',rerun,
  'nameFrom',m.name_from,'moved',moved,'removed',removed,'detail',v_detail);
end $$;

-- The next linked pair with no merge yet (oldest link first), or null when every pair is done.
create function public.chat_merge_next_linked_profile() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare next_lb uuid;
begin
 select l.lb_account_id into next_lb from public.chat_shortscout_membership_links l
 where l.revoked_at is null and not exists(select 1 from public.chat_profile_merges m where m.lb_account_id=l.lb_account_id and m.undone_at is null)
 order by l.created_at, l.lb_account_id limit 1;
 if next_lb is null then return null; end if;
 return public.chat_merge_linked_profile(next_lb);
end $$;

-- ---- Undo ----
create function public.chat_unmerge_linked_profile(p_merge bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.chat_profile_merges; e record; keys text[]; cols text; tbl regclass; c integer; restored integer:=0; skipped integer:=0; ident boolean;
begin
 set local lock_timeout = '5s';
 select * into m from public.chat_profile_merges where id=p_merge for update;
 if not found then raise exception 'merge_not_found'; end if;
 if m.undone_at is not null then raise exception 'merge_already_undone'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-profile-merge:'||m.lb_account_id::text,0));
 set local session_replication_role = replica;
 for e in select * from public.chat_profile_merge_log where merge_id=p_merge order by id desc loop
  tbl:=e.table_name::regclass;
  if e.op='update' then
   keys:=public.chat_merge_key_columns(tbl);
   if not (e.column_name=any(keys)) then keys:=keys||e.column_name; end if;
   execute format('update %1$s t set %2$I=(jsonb_populate_record(null::%1$s,$1)).%2$I from jsonb_populate_record(null::%1$s,$2) r where %3$s',
    tbl,e.column_name,(select string_agg(format('t.%1$I is not distinct from r.%1$I',k),' and ') from unnest(keys) k))
   using jsonb_build_object(e.column_name,e.old_value), e.row_data;
  elsif e.op='insert' then
   keys:=public.chat_merge_key_columns(tbl);
   execute format('delete from %1$s t using jsonb_populate_record(null::%1$s,$1) r where %2$s',
    tbl,(select string_agg(format('t.%1$I is not distinct from r.%1$I',k),' and ') from unnest(keys) k)) using e.row_data;
  else
   select string_agg(quote_ident(a.attname),',' order by a.attnum), bool_or(a.attidentity='a') into cols, ident
   from pg_attribute a where a.attrelid=tbl and a.attnum>0 and not a.attisdropped and a.attgenerated='';
   execute format('insert into %1$s(%2$s) %3$s select %2$s from jsonb_populate_record(null::%1$s,$1) on conflict do nothing',
    tbl,cols,case when ident then 'overriding system value' else '' end) using e.row_data;
  end if;
  get diagnostics c = row_count;
  if c>0 then restored:=restored+1; else skipped:=skipped+1; end if;
 end loop;
 if m.placeholder_account_id is not null and not exists(select 1 from public.longboard_chat_members where user_id=m.placeholder_account_id) then
  delete from public.chat_accounts where id=m.placeholder_account_id;
 end if;
 set local session_replication_role = origin;
 if to_regprocedure('public.chat_activity_counter_refresh_account(uuid,text)') is not null then
  perform public.chat_activity_counter_refresh_account(m.lb_account_id,null);
  perform public.chat_activity_counter_refresh_account(m.source_account_id,null);
 end if;
 update public.chat_profile_merges set undone_at=now(), undo_skipped=skipped, updated_at=now() where id=p_merge;
 return jsonb_build_object('mergeId',p_merge,'restored',restored,'skipped',skipped);
end $$;

revoke all on function public.chat_merge_key_columns(regclass), public.chat_merge_delete(bigint,regclass,text), public.chat_merge_insert(bigint,regclass,jsonb),
 public.chat_merge_set(bigint,regclass,text,jsonb,text), public.chat_merge_move(bigint,regclass,text,uuid,uuid),
 public.chat_merge_member_columns(), public.chat_merge_account_columns(), public.chat_merge_linked_profile(uuid),
 public.chat_merge_next_linked_profile(), public.chat_unmerge_linked_profile(bigint)
 from public, anon, authenticated, service_role;

-- ---- No second profile on a linked ShortScout account ----
create function public.chat_member_link_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.chat_shortscout_membership_links where source_account_id=new.user_id and revoked_at is null) then
  raise exception 'shortscout_profile_linked';
 end if;
 return new;
end $$;
revoke all on function public.chat_member_link_guard() from public, anon, authenticated;
create trigger chat_member_link_guard before insert or update of user_id on public.longboard_chat_members
 for each row execute function public.chat_member_link_guard();

-- ---- Sign-in: a linked ShortScout login uses the Longboard profile ----
-- Current definition (20261001190002_chat_shortscout_authorization.sql), plus the #444 block in
-- the ShortScout-only branch and the session's shortscout_only mark.
create or replace function public.consume_chat_login(
 p_state_hash text,p_code_hash text,p_challenge text,p_link_user_id uuid,p_session_hash text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.chat_login_requests; a uuid; existing_account uuid; source_lb uuid;
 prior public.chat_shortscout_membership_links; bridge boolean:=false; linked_lb uuid; ss_only boolean:=false;
begin
 select * into r from public.chat_login_requests where state_hash=p_state_hash for update;
 if not found or r.consumed_at is not null or r.expires_at<=now() or r.code_hash is null or p_code_hash is null or p_challenge is null
  or r.code_hash<>p_code_hash or r.challenge<>p_challenge or r.link_user_id is distinct from p_link_user_id then raise exception 'invalid_login_handoff'; end if;
 if r.expected_subject is not null and r.subject is distinct from r.expected_subject then raise exception 'identity_mismatch'; end if;
 if r.return_room in ('shortscout','ss-announcements','ss-recordings') and r.membership_level is distinct from 'mastermind' then raise exception 'insufficient_membership'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-provider:shortscout:'||r.subject::text,0));
 select account_id into existing_account from public.chat_provider_identities where provider='shortscout' and subject=r.subject;
 if r.link_user_id is not null then
  if not exists(select 1 from public.profiles where id=r.link_user_id) then raise exception 'longboard_membership_required'; end if;
  insert into public.chat_accounts(id,longboard_user_id) values(r.link_user_id,r.link_user_id) on conflict(longboard_user_id) do nothing;
  select id into a from public.chat_accounts where longboard_user_id=r.link_user_id for update;
  -- Current application deliberately preserves LB account ID = LB auth ID.
  if a is distinct from r.link_user_id then raise exception 'identity_already_linked'; end if;
  if exists(select 1 from public.chat_provider_identities where account_id=a and provider='shortscout' and subject<>r.subject)
   or exists(select 1 from public.chat_shortscout_membership_links where lb_account_id=a and subject<>r.subject)
   or exists(select 1 from public.chat_shortscout_membership_links where subject=r.subject and lb_account_id<>a)
  then raise exception 'identity_already_linked'; end if;
  if existing_account is not null and existing_account<>a then
   select longboard_user_id into source_lb from public.chat_accounts where id=existing_account and longboard_user_id is null for update;
   if not found then raise exception 'identity_already_linked'; end if;
   select * into prior from public.chat_shortscout_membership_links where lb_account_id=a for update;
   if prior.revoked_at is not null and prior.revoked_at>=r.created_at then raise exception 'link_session_changed'; end if;
   insert into public.chat_shortscout_membership_links(lb_account_id,source_account_id,subject)
   values(a,existing_account,r.subject)
   on conflict(lb_account_id) do update set revoked_at=null,updated_at=now()
    where chat_shortscout_membership_links.source_account_id=excluded.source_account_id and chat_shortscout_membership_links.subject=excluded.subject;
   if prior.lb_account_id is null or prior.revoked_at is not null then
    insert into public.chat_shortscout_link_events(lb_account_id,source_account_id,subject,action,request_hash)
    values(a,existing_account,r.subject,case when prior.lb_account_id is null then 'connected' else 'reactivated' end,p_state_hash);
   end if;
   bridge:=true;
  end if;
 else
  a:=existing_account;
  -- #444: a ShortScout identity linked to a Longboard account, whose own account has no chat
  -- profile (merged into the Longboard one, or never made), signs in to the Longboard account and
  -- its profile, with ShortScout access only (shortscout_only), instead of asking for a new name.
  if existing_account is not null and not exists(select 1 from public.longboard_chat_members where user_id=existing_account) then
   select l.lb_account_id into linked_lb from public.chat_shortscout_membership_links l
   join public.chat_accounts lb on lb.id=l.lb_account_id and lb.longboard_user_id=lb.id
   join public.profiles p on p.id=lb.longboard_user_id
   where l.source_account_id=existing_account and l.subject=r.subject and l.revoked_at is null;
   if linked_lb is not null then a:=linked_lb; ss_only:=true; end if;
  end if;
  if a is null then insert into public.chat_accounts default values returning id into a; end if;
 end if;
 -- Refresh the original identity; never move its ownership or historical actor.
 insert into public.chat_provider_identities(provider,subject,account_id,membership_level)
 values('shortscout',r.subject,coalesce(existing_account,a),r.membership_level)
 on conflict(provider,subject) do update set membership_level=excluded.membership_level,verified_at=now();
 -- A genuinely new, validated legacy login gets one bounded transition horizon.
 -- All old identity horizons (including expired ones) were captured at migration;
 -- neither callbacks nor deletion/recreation can extend or recreate those grants.
 if existing_account is null and not exists(select 1 from public.chat_shortscout_authorization where subject=r.subject) then
  insert into public.chat_shortscout_legacy_access(subject,membership_level,expires_at)
  select r.subject,r.membership_level,least(clock_timestamp()+interval '12 hours',legacy_until)
  from public.chat_shortscout_rollout where clock_timestamp()<legacy_until
  on conflict(subject) do nothing;
 end if;
 insert into public.chat_sessions(token_hash,account_id,expires_at,shortscout_only) values(p_session_hash,a,now()+interval '12 hours',ss_only);
 update public.chat_login_requests set consumed_at=now() where state_hash=p_state_hash;
 return jsonb_build_object('accountId',a,'room',r.return_room,'popout',r.popout,'membershipBridge',bridge);
end $$;

-- Current definition (20261109100000_members_stripe.sql), plus: a shortscout_only sign-in has no
-- Longboard access, Boardroom or role from the Longboard profile it uses.
CREATE OR REPLACE FUNCTION public.chat_session_request_context(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare account public.chat_accounts; profile public.profiles; ss_only boolean;
begin
 select a.* into account from public.chat_sessions s join public.chat_accounts a on a.id=s.account_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>clock_timestamp();
 if not found then return jsonb_build_object('mode','unauthenticated'); end if;
 select s.shortscout_only into ss_only from public.chat_sessions s where s.token_hash=p_token_hash;
 -- #330: a bot account only ever works through its API token.
 if exists(select 1 from public.chat_bot_accounts b where b.account_id=account.id) then return jsonb_build_object('mode','unauthenticated'); end if;
 if account.longboard_user_id is not null and not ss_only then
  select * into profile from public.profiles where id=account.longboard_user_id;
 end if;
 return jsonb_build_object('mode','ok','account',account.id,
  'longboard',profile.id is not null,
  'role',profile.role,
  'boardroom',profile.id is not null and exists(select 1 from public.user_tags
    where user_id=account.longboard_user_id and tag in ('boardroom-cohort-1','boardroom-cohort-2')),
  'shortscout',public.begin_chat_shortscout_renewal(account.id,p_token_hash),
  'member',to_jsonb(public.member_account_entitlements(account.id)));
end $function$;

-- ---- Tags: retired profiles are not anyone ----
-- Current definitions (20261111120000_chat_tags_follow_person.sql), plus "merged_into is null".
create or replace function public.chat_message_tag_scan(p_body text,p_message uuid,p_history boolean)
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
    where not p_history and m.merged_into is null
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

create or replace function public.chat_tag_lookup(p_actor uuid,p_rooms text[],p_names text[],p_messages uuid[])
returns table(message_id uuid,tag_key text,member_id uuid,display_name text,avatar_path text)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_names),0)>60 or coalesce(cardinality(p_messages),0)>60 then raise exception 'invalid_query'; end if;
 return query
 select null::uuid,lower(m.display_name),m.id,m.display_name,m.avatar_path from public.longboard_chat_members m
  where lower(m.display_name)=any(coalesce(p_names,'{}')) and m.merged_into is null
 union all
 select t.message_id,t.tag_key,m.id,m.display_name,m.avatar_path
  from public.chat_message_tags t
  join public.longboard_chat_messages msg on msg.id=t.message_id
  join public.longboard_chat_members m on m.id=t.member_id
  where t.message_id=any(coalesce(p_messages,'{}')) and msg.room_slug=any(coalesce(p_rooms,'{}'))
   and msg.deleted_at is null and not msg.removed and public.chat_account_has_room(p_actor,msg.room_slug);
end $$;

create or replace function public.chat_tag_suggestions(p_query text,p_hidden uuid[],p_limit integer default 10)
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
   and not exists(select 1 from public.longboard_chat_members cur where lower(cur.display_name)=n.name_key and cur.id<>m.id and cur.merged_into is distinct from m.id)
  where (lower(m.display_name) like q escape '\' or n.member_id is not null)
   and m.merged_into is null
   and not (m.user_id=any(coalesce(p_hidden,'{}')))
  order by m.id,n.display_name
 ) s order by s.current_match desc,s.display_name,s.id limit p_limit;
end $$;
