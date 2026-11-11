-- #444 READ-ONLY report: every active Longboard + ShortScout link, the profile kept, the profile
-- retired and how many rows a merge would move. Runs before or after the migration; writes nothing.
-- Names only (no emails). One row per link, plus totals in the last columns.
-- kept_name is the name (and picture) that will be kept: the profile the person posted from most
-- recently (latest room or DM message); if neither ever posted, the Longboard one. name_from says
-- which side it comes from (Longboard / ShortScout); retired_name is the other profile's name.
--   mode: merge  = both profiles exist; the Longboard one is kept, the ShortScout one is retired
--         adopt  = only the ShortScout profile exists; it moves to the Longboard account as it is
--         attach = no ShortScout profile; only the ShortScout account's own rows and sign-ins move
-- rows_to_move counts rows that point at the retired profile (every foreign key to the member or
-- guest id, found in pg_catalog) plus the ShortScout account's own rows that move (listed below),
-- plus live sign-ins. Collisions are counted separately: they keep the Longboard row.
with raw as (
 select l.lb_account_id lb, l.source_account_id ss, l.created_at,
  k.id kept_id, k.display_name lb_name, r.id retired_id, r.display_name ss_name,
  case when k.id is not null and r.id is not null then 'merge' when r.id is not null then 'adopt' else 'attach' end mode,
  greatest((select max(m.created_at) from public.longboard_chat_messages m where m.member_id=k.id),
   (select max(d.created_at) from public.longboard_chat_direct_messages d where d.sender_id=k.id)) lb_last,
  greatest((select max(m.created_at) from public.longboard_chat_messages m where m.member_id=r.id),
   (select max(d.created_at) from public.longboard_chat_direct_messages d where d.sender_id=r.id)) ss_last
 from public.chat_shortscout_membership_links l
 left join public.longboard_chat_members k on k.user_id=l.lb_account_id
 left join public.longboard_chat_members r on r.user_id=l.source_account_id
 where l.revoked_at is null
), links as (
 select raw.*,
  case when mode='adopt' or (mode='merge' and ss_last is not null and (lb_last is null or ss_last>lb_last)) then 'ShortScout' else 'Longboard' end name_from
 from raw
), named as (
 select links.*,
  case when name_from='ShortScout' then ss_name else lb_name end kept_name,
  case when mode<>'merge' then null when name_from='ShortScout' then lb_name else ss_name end retired_name
 from links
), member_cols as (
 select c.conrelid::regclass t, a.attname::text col
 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.contype='f' and cardinality(c.conkey)=1
  and c.confrelid in ('public.longboard_chat_members'::regclass,'public.longboard_chat_guests'::regclass)
  and c.conrelid not in ('public.longboard_chat_members'::regclass,'public.longboard_chat_guests'::regclass)
 group by 1,2
), account_cols as (
 select to_regclass(t) t, col from (values
  ('public.chat_room_mentions','account_id'),('public.chat_room_reads','account_id'),('public.chat_reaction_notifications','account_id'),
  ('public.chat_favorites','account_id'),('public.chat_conversation_pins','account_id'),('public.chat_room_notification_levels','account_id'),
  ('public.chat_push_subscriptions','account_id'),('public.chat_activity_preferences','account_id'),('public.chat_card_layouts','account_id'),
  ('public.chat_summary_requests','account_id'),('public.chat_summary_deliveries','account_id'),('public.chat_room_message_pins','pinned_by'),
  ('public.chat_feature_notifications','account_id'),('public.chat_feature_notification_mutes','account_id'),
  ('public.chat_feature_notification_preferences','account_id'),('public.reader_progress','account_id')
 ) v(t,col) where to_regclass(t) is not null
), counts as (
 select l.lb, mc.t::text||'.'||mc.col k,
  (xpath('/row/n/text()',query_to_xml(format('select count(*) n from %s where %I=%L',mc.t,mc.col,l.retired_id),false,true,'')))[1]::text::bigint n
 from links l cross join member_cols mc where l.mode='merge'
 union all
 select l.lb, ac.t::text||'.'||ac.col,
  (xpath('/row/n/text()',query_to_xml(format('select count(*) n from %s where %I=%L',ac.t,ac.col,l.ss),false,true,'')))[1]::text::bigint
 from links l cross join account_cols ac
 union all
 select l.lb, 'chat_sessions (live sign-ins)', count(s.token_hash)
 from links l left join public.chat_sessions s on s.account_id=l.ss and s.revoked_at is null and s.expires_at>now() group by l.lb
), per_link as (
 select lb, sum(n) total, jsonb_object_agg(k,n) filter (where n>0) breakdown from counts group by lb
), per_pair as (
 select l.*, coalesce(p.total,0) rows_to_move, coalesce(p.breakdown,'{}') breakdown,
  (select count(*) from public.longboard_chat_conversations c where l.mode='merge'
    and least(c.requester_id,c.recipient_id)=least(l.kept_id,l.retired_id) and greatest(c.requester_id,c.recipient_id)=greatest(l.kept_id,l.retired_id)) dm_between_the_two,
  (select count(*) from public.longboard_chat_conversations c join public.longboard_chat_conversations c2
    on least(c2.requester_id,c2.recipient_id)=least(l.kept_id,case when c.requester_id=l.retired_id then c.recipient_id else c.requester_id end)
   and greatest(c2.requester_id,c2.recipient_id)=greatest(l.kept_id,case when c.requester_id=l.retired_id then c.recipient_id else c.requester_id end)
   where l.mode='merge' and l.retired_id in (c.requester_id,c.recipient_id) and l.kept_id not in (c.requester_id,c.recipient_id)) dm_partners_in_both,
  (select count(*) from public.longboard_chat_reactions a join public.longboard_chat_reactions b on b.message_id=a.message_id and b.guest_id=l.kept_id
   where l.mode='merge' and a.guest_id=l.retired_id) likes_by_both,
  (select count(*) from public.chat_message_reaction_choices a join public.chat_message_reaction_choices b on b.member_id=l.kept_id and b.emoji=a.emoji
    and b.room_message_id is not distinct from a.room_message_id and b.dm_message_id is not distinct from a.dm_message_id
   where l.mode='merge' and a.member_id=l.retired_id) reactions_by_both,
  (select count(*) from public.chat_room_mentions a join public.chat_room_mentions b on b.account_id=l.lb and b.message_id=a.message_id
   where a.account_id=l.ss) notifications_for_both,
  (select count(*) from public.chat_room_reads a join public.chat_room_reads b on b.account_id=l.lb and b.room_slug=a.room_slug
   where a.account_id=l.ss) read_positions_in_both
 from named l left join per_link p on p.lb=l.lb
)
select kept_name, name_from, retired_name, mode, rows_to_move, dm_between_the_two, dm_partners_in_both, likes_by_both, reactions_by_both,
 notifications_for_both, read_positions_in_both, breakdown,
 count(*) over () links, count(*) filter (where mode='merge') over () pairs_to_merge, sum(rows_to_move) over () total_rows_to_move
from per_pair
order by mode, lower(coalesce(kept_name,'')), created_at;
