-- D-212 comparison before the migration, read-only: works out the counter rows inline (the same
-- rules as chat_activity_counter_compute in 20261024120000_chat_activity_counters.sql) and the
-- bell's numbers from them (as chat_activity_counts does), then compares with
-- chat_activity_inbox for every chat account, with the room list each account may read.
--   timeout 60 supabase db query --linked --project-ref qnwizieggisnbjqyxrjo -f scripts/sql/chat-activity-counters-precheck.sql
-- Output: numbers and one-way account tags only.
with keys as (select array['roomLevels','replyNotifications','mentionCount','mentionThrough','roomCounts','roomThrough',
  'pinnedDmUnread','dmCount','dmThrough','reactionCount','reactionThrough'] k),
acc as (
 select a.id,array(select r from unnest(array['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new']) with ordinality u(r,o)
  where public.chat_account_has_room(a.id,r) order by o) rooms
 from public.chat_accounts a
),
me as (select a.id account_id,m.id member_id from public.chat_accounts a join public.longboard_chat_members m on m.user_id=a.id),
blocked as (
 select a.id account_id,coalesce(array_agg(case when b.blocker_id=me.member_id then b.blocked_id else b.blocker_id end) filter (where b.blocker_id is not null),'{}'::uuid[]) ids
 from public.chat_accounts a left join me on me.account_id=a.id
 left join public.longboard_chat_blocks b on b.blocker_id=me.member_id or b.blocked_id=me.member_id
 group by a.id
),
counter_rows as (
 select n.account_id,'mention'::text kind,n.room_slug scope,count(*)::integer unread,max(n.seq) through_seq
 from public.chat_room_mentions n join public.longboard_chat_messages m on m.id=n.message_id
 left join public.longboard_chat_messages parent on parent.id=n.thread_root_id
 join blocked bl on bl.account_id=n.account_id
 where n.read_at is null and m.deleted_at is null and not m.removed
  and not coalesce(m.member_id=any(bl.ids),false) and not coalesce(parent.member_id=any(bl.ids),false)
 group by n.account_id,n.room_slug
 union all
 select n.account_id,'room_reaction',m.room_slug,count(*)::integer,max(n.seq)
 from public.chat_reaction_notifications n join me on me.account_id=n.account_id
 join public.longboard_chat_messages m on m.id=n.room_message_id and m.member_id=me.member_id
 join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id
 join blocked bl on bl.account_id=n.account_id
 where n.room_message_id is not null and n.read_at is null and m.deleted_at is null and not m.removed and reactor.id<>all(bl.ids)
 group by n.account_id,m.room_slug
 union all
 select n.account_id,'dm_reaction',c.id::text,count(*)::integer,max(n.seq)
 from public.chat_reaction_notifications n join me on me.account_id=n.account_id
 join public.longboard_chat_direct_messages m on m.id=n.dm_message_id and m.sender_id=me.member_id
 join public.longboard_chat_conversations c on c.id=m.conversation_id and me.member_id in(c.requester_id,c.recipient_id)
 join public.longboard_chat_members reactor on reactor.id=n.reactor_member_id and reactor.id in(c.requester_id,c.recipient_id)
 join blocked bl on bl.account_id=n.account_id
 where n.dm_message_id is not null and n.read_at is null and m.deleted_at is null and c.status='accepted' and reactor.id<>all(bl.ids)
 group by n.account_id,c.id
 union all
 select me.account_id,'dm',c.id::text,d.unread::integer,d.through_seq
 from me join public.longboard_chat_conversations c on c.requester_id=me.member_id or c.recipient_id=me.member_id
 join public.longboard_chat_members other on other.id=case when c.requester_id=me.member_id then c.recipient_id else c.requester_id end
 join blocked bl on bl.account_id=me.account_id
 cross join lateral (
  select count(*) unread,max(d.seq) through_seq from public.longboard_chat_direct_messages d
  where d.conversation_id=c.id and d.sender_id<>me.member_id and d.deleted_at is null
   and d.seq>case when c.requester_id=me.member_id then c.requester_read_seq else c.recipient_read_seq end
 ) d
 where c.status<>'declined' and other.id<>all(bl.ids) and d.unread>0
),
per as (
 select a.id,a.rooms,
  case when 'social'=any(a.rooms) then true else public.chat_account_has_room(a.id,'social') end social_ok,
  coalesce((select jsonb_object_agg(p.room_slug,p.level) from public.chat_room_notification_levels p where p.account_id=a.id and p.room_slug=any(a.rooms)),'{}'::jsonb) room_levels,
  coalesce((select array_agg(p.room_slug) from public.chat_room_notification_levels p where p.account_id=a.id and p.room_slug=any(a.rooms)
   and (p.level='muted' or (p.level='mentions' and p.room_slug in ('lb-announcements','ss-announcements','lb-recordings','ss-recordings')))),'{}'::text[]) quiet_mentions,
  coalesce((select array_agg(p.room_slug) from public.chat_room_notification_levels p where p.account_id=a.id and p.room_slug=any(a.rooms) and p.level in ('muted','mentions')),'{}'::text[]) quiet_reactions
 from acc a
),
counts as (
 select p.id,jsonb_build_object(
  'roomLevels',p.room_levels,
  'replyNotifications',coalesce((select replies from public.chat_activity_preferences where account_id=p.id),true),
  'mentionCount',coalesce((select sum(unread) from counter_rows r where r.account_id=p.id and r.kind='mention' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_mentions)),0),
  'mentionThrough',coalesce((select max(through_seq) from counter_rows r where r.account_id=p.id and r.kind='mention' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_mentions)),0),
  'roomCounts',coalesce((select jsonb_object_agg(r.scope,r.unread) from counter_rows r where r.account_id=p.id and r.kind='mention' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_mentions)),'{}'::jsonb),
  'roomThrough',coalesce((select jsonb_object_agg(r.scope,r.through_seq) from counter_rows r where r.account_id=p.id and r.kind='mention' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_mentions)),'{}'::jsonb),
  'pinnedDmUnread',coalesce((select jsonb_object_agg(x.id,x.unread) from (
    select pin.conversation_id id,coalesce((select r.unread from counter_rows r where r.account_id=p.id and r.kind='dm' and r.scope=c.id::text),0) unread
    from public.chat_conversation_pins pin join me on me.account_id=p.id
    join public.longboard_chat_conversations c on c.id=pin.conversation_id and c.status='accepted' and me.member_id in (c.requester_id,c.recipient_id)
    join public.longboard_chat_members other on other.id=case when c.requester_id=me.member_id then c.recipient_id else c.requester_id end
    where pin.account_id=p.id and p.social_ok
     and not exists(select 1 from public.longboard_chat_blocks b where (b.blocker_id=me.member_id and b.blocked_id=other.id) or (b.blocker_id=other.id and b.blocked_id=me.member_id))
     and public.chat_account_room_recipient_eligible(other.user_id,'social')
    order by pin.id limit 50) x),'{}'::jsonb),
  'dmCount',coalesce((select sum(unread) from counter_rows r where r.account_id=p.id and r.kind='dm' and p.social_ok),0),
  'dmThrough',coalesce((select max(through_seq) from counter_rows r where r.account_id=p.id and r.kind='dm' and p.social_ok),0),
  'reactionCount',coalesce((select sum(unread) from counter_rows r where r.account_id=p.id and ((r.kind='room_reaction' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_reactions)) or (r.kind='dm_reaction' and p.social_ok))),0),
  'reactionThrough',coalesce((select max(through_seq) from counter_rows r where r.account_id=p.id and ((r.kind='room_reaction' and r.scope=any(p.rooms) and r.scope<>all(p.quiet_reactions)) or (r.kind='dm_reaction' and p.social_ok))),0)
 ) c from per p
),
cmp as (
 select a.id,k.c,(select jsonb_object_agg(key,i.i->key) from unnest((select k from keys)) key) i
 from acc a join counts k on k.id=a.id cross join lateral (select public.chat_activity_inbox(a.id,a.rooms) i) i
)
select
 (select count(*) from cmp) accounts,
 (select count(*) from cmp where c=i) matching,
 (select count(*) from cmp where (i->>'mentionCount')::int+(i->>'dmCount')::int+(i->>'reactionCount')::int>0) accounts_with_something_unread,
 (select sum((i->>'mentionCount')::int) from cmp) mentions_total,(select sum((i->>'dmCount')::int) from cmp) dms_total,(select sum((i->>'reactionCount')::int) from cmp) reactions_total,
 (select count(*) from counter_rows) counter_rows,
 (select count(*) from cmp where i->'pinnedDmUnread'<>'{}'::jsonb) accounts_with_pinned_dms,
 coalesce((select jsonb_agg(jsonb_build_object('acct',left(md5(id::text),8),
   'fields',(select jsonb_object_agg(key,jsonb_build_object('inbox',i->key,'counters',c->key)) from unnest((select k from keys)) key where (i->key) is distinct from (c->key))))
  from cmp where c<>i),'[]'::jsonb) mismatches;
