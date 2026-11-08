-- #387 News Feed: every press release for the stocks in the gainers room, from DilutionTracker.
--
-- Polygon misses most small-cap press releases (ACCESS Newswire and the like); DilutionTracker's
-- News tab lists them all with the wire's name. The lookup program on Rob's computer reads that tab
-- ONCE per ticker per Eastern day, when the ticker first shows up in that day's Gainers Table (Rob:
-- "check DT once for a press release when it hits the gainers channel, and then not again afterward
-- until the next day").
--
--  * chat_gainers_news: one row per press release per ticker (the last ~30 days of them, as the
--    lookup read them): when it was published, the wire's name, the headline and the link
--    (DilutionTracker's dilution.news short link). item_key is DilutionTracker's item id (or the
--    link when it has none), so reading the same release again changes nothing.
--  * chat_gainers_news_checks: one row per ticker per Eastern day whose news was read. The facts
--    route stops listing a ticker for news once it has a row for today.
--  * Written only by the lookup program through /api/chat/gainers/facts (its own token,
--    CHAT_GAINERS_LOOKUP_TOKEN); read only by server code, for members who can open the gainers
--    room (/api/chat/news/feed). RLS on, no policies, service role only.
--  * save_chat_gainers_news(day, ticker, items): the only write. Saves the items, marks the ticker
--    read for the day, and forgets that ticker's releases older than 45 days.
--  * chat_gainers_news_checked(day): the tickers read that day. chat_gainers_news_for(tickers,
--    since): their releases since then, newest first.
--
-- Additive: nothing existing changes. The app copes with this not being applied yet (the feed shows
-- Polygon and FMP only, and the lookup is told no news reads are due).
-- Rollback: supabase/rollbacks/20261108180000_chat_gainers_news.down.sql

create table public.chat_gainers_news(
 ticker text not null check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 item_key text not null check(char_length(item_key) between 1 and 300),
 published_at timestamptz not null,
 source text not null default '' check(char_length(source) <= 80),
 title text not null check(char_length(title) between 1 and 300),
 url text not null check(char_length(url) <= 2000 and url ~ '^https?://'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(ticker,item_key)
);
create index chat_gainers_news_recent on public.chat_gainers_news(ticker,published_at desc);
alter table public.chat_gainers_news enable row level security;
revoke all on public.chat_gainers_news from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.chat_gainers_news to service_role;

create table public.chat_gainers_news_checks(
 day date not null,
 ticker text not null check(ticker ~ '^[A-Z][A-Z. ]{0,11}$'),
 items integer not null default 0 check(items >= 0),
 checked_at timestamptz not null default now(),
 primary key(day,ticker)
);
alter table public.chat_gainers_news_checks enable row level security;
revoke all on public.chat_gainers_news_checks from public,anon,authenticated,service_role;
grant select,insert,update on public.chat_gainers_news_checks to service_role;

create function public.chat_gainers_news_checked(p_day date)
returns table(ticker text)
language sql stable set search_path='' as $$
 select c.ticker from public.chat_gainers_news_checks c where c.day=p_day order by c.ticker limit 1000;
$$;
revoke all on function public.chat_gainers_news_checked(date) from public,anon,authenticated;
grant execute on function public.chat_gainers_news_checked(date) to service_role;

create function public.chat_gainers_news_for(p_tickers text[],p_since timestamptz)
returns table(ticker text,item_key text,published_at timestamptz,source text,title text,url text)
language sql stable set search_path='' as $$
 select n.ticker,n.item_key,n.published_at,n.source,n.title,n.url
 from public.chat_gainers_news n
 where n.ticker=any(p_tickers) and n.published_at>=p_since
 order by n.published_at desc,n.ticker,n.item_key limit 2000;
$$;
revoke all on function public.chat_gainers_news_for(text[],timestamptz) from public,anon,authenticated;
grant execute on function public.chat_gainers_news_for(text[],timestamptz) to service_role;

-- One read of a ticker's News tab: p_items is [{key, published_at, source, title, url}, ...]
-- (checked by the route first). Returns how many items it saved.
create function public.save_chat_gainers_news(p_day date,p_ticker text,p_items jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare saved integer;
begin
 insert into public.chat_gainers_news as n(ticker,item_key,published_at,source,title,url)
 select p_ticker,i->>'key',(i->>'published_at')::timestamptz,coalesce(i->>'source',''),i->>'title',i->>'url'
 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i
 on conflict(ticker,item_key) do update set published_at=excluded.published_at,source=excluded.source,
  title=excluded.title,url=excluded.url,updated_at=now();
 get diagnostics saved=row_count;
 delete from public.chat_gainers_news n where n.ticker=p_ticker and n.published_at<now()-interval '45 days';
 insert into public.chat_gainers_news_checks as c(day,ticker,items,checked_at) values(p_day,p_ticker,saved,now())
 on conflict(day,ticker) do update set items=excluded.items,checked_at=now();
 return saved;
end $$;
revoke all on function public.save_chat_gainers_news(date,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_chat_gainers_news(date,text,jsonb) to service_role;
