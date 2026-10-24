-- D-212 comparison, read-only: the bell's numbers from the counters (chat_activity_counts) next
-- to chat_activity_inbox, for every chat account, with the room list each account may read
-- (the database's own room check, which is what the app passes). Also checks that every stored
-- counter row equals a fresh recount (no drift). Needs 20261024120000_chat_activity_counters.sql.
-- Before that migration, use chat-activity-counters-precheck.sql (same comparison, counters
-- worked out inline).
--   timeout 60 supabase db query --linked --project-ref qnwizieggisnbjqyxrjo -f scripts/sql/chat-activity-counters-compare.sql
-- A write landing between the two reads of one account can show as a one-off difference; run
-- it again and a real difference stays. Output: numbers and one-way account tags only.
with keys as (select array['roomLevels','replyNotifications','mentionCount','mentionThrough','roomCounts','roomThrough',
  'pinnedDmUnread','dmCount','dmThrough','reactionCount','reactionThrough'] k),
acc as (
 select a.id,array(select r from unnest(array['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new']) with ordinality u(r,o)
  where public.chat_account_has_room(a.id,r) order by o) rooms
 from public.chat_accounts a
),
timed as (
 select a.id,clock_timestamp() t0,public.chat_activity_counts(a.id,a.rooms) c,clock_timestamp() t1,public.chat_activity_inbox(a.id,a.rooms) i,clock_timestamp() t2
 from acc a
),
cmp as (
 select t.id,t.c,(select jsonb_object_agg(k,t.i->k) from unnest((select k from keys)) k) i,
  extract(epoch from t.t1-t.t0)*1000 counts_ms,extract(epoch from t.t2-t.t1)*1000 inbox_ms
 from timed t
),
stored as (select account_id,kind,scope,unread,through_seq from public.chat_activity_counters),
fresh as (select a.id account_id,c.kind,c.scope,c.unread,c.through_seq from public.chat_accounts a cross join lateral public.chat_activity_counter_compute(a.id) c),
drift as (select * from (select * from stored except select * from fresh) x union all select * from (select * from fresh except select * from stored) y)
select
 (select count(*) from cmp) accounts,
 (select count(*) from cmp where c=i) matching,
 (select count(*) from cmp where (i->>'mentionCount')::int+(i->>'dmCount')::int+(i->>'reactionCount')::int>0) accounts_with_something_unread,
 (select sum((i->>'mentionCount')::int) from cmp) mentions_total,(select sum((i->>'dmCount')::int) from cmp) dms_total,(select sum((i->>'reactionCount')::int) from cmp) reactions_total,
 (select round(avg(counts_ms)::numeric,3) from cmp) counts_avg_ms,(select round(avg(inbox_ms)::numeric,3) from cmp) inbox_avg_ms,
 (select count(*) from stored) counter_rows,(select count(*) from drift) drifted_rows,
 coalesce((select jsonb_agg(jsonb_build_object('acct',left(md5(id::text),8),
   'fields',(select jsonb_object_agg(k,jsonb_build_object('inbox',i->k,'counters',c->k)) from unnest((select k from keys)) k where (i->k) is distinct from (c->k))))
  from cmp where c<>i),'[]'::jsonb) mismatches;
