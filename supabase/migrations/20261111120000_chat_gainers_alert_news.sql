-- #436 Gainers: the latest press release headline and link under a stock's first alert of the day.
--
-- When a stock first alerts on Gainers in an Eastern day, the lookup program on Rob's computer reads
-- its DilutionTracker News tab once (#387, kind "news" on /api/chat/gainers/facts, saved by
-- save_chat_gainers_news). Right after that read is saved, the route calls
-- post_chat_gainers_alert_news below, which puts the newest release under that first alert: the
-- headline as a link to the release, its wire and its Eastern time.
--
--  * Where it shows: the Gainers room is broadcast only. enforce_chat_gainers_source refuses every
--    reply and every non-alert post there, and every post in the room is read as a stock alert (the
--    Gainers Table, the nightly gainers page, pushes, unread counts). So the headline is not a new
--    chat message: it is one row here, tied to the alert's message id, that the room's history read
--    attaches to that alert (lib/chatGainersAlertNews.ts) and the room shows under the alert's text.
--  * "First alert" is the stock's first alert that day with at least 150,000 shares of volume, the
--    one that put it on the Gainers Table (chat_gainers_table's rule) and so started the news read.
--  * Posted at most once per stock per Eastern day: the primary key (day, ticker) is the guard, and
--    each alert carries at most one (alert_message_id unique). Retries, repeated reads and later
--    alerts find the row there and post nothing.
--  * Nothing is posted when the stock has no saved releases, when its newest release is more than 3
--    days old, or once its first alert is more than 30 minutes old (a read that kept failing and
--    arrived late). Only DilutionTracker's releases (chat_gainers_news) are used.
--  * Written only by post_chat_gainers_alert_news (service role, called by the facts route with the
--    lookup's own token); read only by server code for members who can open the Gainers room.
--    RLS on, no policies, service role only.
--
-- Additive: nothing existing changes. The app copes with this not being applied yet (the news read is
-- saved as before and the room shows no headlines).
-- Rollback: supabase/rollbacks/20261111120000_chat_gainers_alert_news.down.sql

create table public.chat_gainers_alert_news(
 day date not null,
 ticker text not null check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 alert_message_id uuid not null unique references public.longboard_chat_messages(id) on delete cascade,
 item_key text not null check(char_length(item_key) between 1 and 300),
 published_at timestamptz not null,
 source text not null default '' check(char_length(source) <= 80),
 title text not null check(char_length(title) between 1 and 300),
 url text not null check(char_length(url) <= 2000 and url ~ '^https?://'),
 posted_at timestamptz not null default now(),
 primary key(day,ticker)
);
alter table public.chat_gainers_alert_news enable row level security;
revoke all on public.chat_gainers_alert_news from public,anon,authenticated,service_role;
grant select,insert on public.chat_gainers_alert_news to service_role;

-- Puts the ticker's newest saved release under its first alert of p_day (Eastern), once. Returns
-- {posted: true, alertMessageId} or {posted: false, reason}: 'duplicate' (already there), 'no_alert'
-- (no alert of 150,000 shares or more that day), 'too_late' (that alert is more than 30 minutes old),
-- 'no_news' (no saved release) or 'stale' (the newest is more than 3 days old).
create function public.post_chat_gainers_alert_news(p_day date,p_ticker text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare alert record; release public.chat_gainers_news; posted uuid;
begin
 if p_day is null or p_ticker is null or p_ticker !~ '^[A-Z][A-Z. ]{0,11}$' then raise exception 'invalid_alert_news'; end if;
 select a.alert_message_id into posted from public.chat_gainers_alert_news a where a.day=p_day and a.ticker=p_ticker;
 if found then return jsonb_build_object('posted',false,'reason','duplicate','alertMessageId',posted); end if;
 -- The alert parsing is chat_gainers_table's (20261110230000_chat_gainers_above_prev_close.sql).
 select m.id,m.created_at into alert
 from public.longboard_chat_messages m
 where m.room_slug='gainers' and m.reply_to_id is null and not m.removed
  and m.created_at>=(p_day::timestamp at time zone 'America/New_York')
  and m.created_at<((p_day+1)::timestamp at time zone 'America/New_York')
  and substring(m.body from '^🚨 ([A-Z. ]+?) \(\+')=p_ticker
  and coalesce(replace(substring(m.body from 'Volume: ([0-9,]{1,20})'),',','')::numeric,0)>=150000
 order by m.created_at,m.id limit 1;
 if not found then return jsonb_build_object('posted',false,'reason','no_alert'); end if;
 if alert.created_at<now()-interval '30 minutes' then return jsonb_build_object('posted',false,'reason','too_late'); end if;
 select * into release from public.chat_gainers_news n where n.ticker=p_ticker order by n.published_at desc,n.item_key limit 1;
 if not found then return jsonb_build_object('posted',false,'reason','no_news'); end if;
 if release.published_at<now()-interval '3 days' then return jsonb_build_object('posted',false,'reason','stale'); end if;
 insert into public.chat_gainers_alert_news(day,ticker,alert_message_id,item_key,published_at,source,title,url)
  values(p_day,p_ticker,alert.id,release.item_key,release.published_at,release.source,release.title,release.url)
  on conflict do nothing returning alert_message_id into posted;
 if posted is null then return jsonb_build_object('posted',false,'reason','duplicate'); end if;
 return jsonb_build_object('posted',true,'alertMessageId',posted);
end $$;
revoke all on function public.post_chat_gainers_alert_news(date,text) from public,anon,authenticated;
grant execute on function public.post_chat_gainers_alert_news(date,text) to service_role;
