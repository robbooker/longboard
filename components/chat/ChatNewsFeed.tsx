"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { filterNews, newItemIds, relativeTime, type NewsFeedData, type NewsFilter, type NewsItem } from "@/lib/chatNews";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatNewsFeed.module.css";

// #383 News Feed: a channel that is a list of headlines, not messages. The stocks in today's
// Gainers Table come first, then the general market, each newest first (the route decides the
// order). It reads again every 60 seconds while the tab is shown. New headlines go straight in
// when the list is scrolled to the top; when the member has scrolled down, the list stays put and a
// "N new" pill waits at the top (tap it, or scroll back up, to show them). Links open in a new tab.
// The same component is the Six view's "news" card (compact). Colours come from the chat theme's
// --chat-* tokens only, so every theme works.

const READ_EVERY_MS = 60_000;
const TICK_MS = 30_000;
/** Within this many pixels of the top counts as "at the top". */
const TOP_SLACK = 8;

const filterKey = (filter: NewsFilter) => (typeof filter === "string" ? filter : `t:${filter.ticker}`);

function Item({ item, now, gainers, fresh }: { item: NewsItem; now: number; gainers: ReadonlySet<string>; fresh: boolean }) {
  return (
    <article
      className={styles.item}
      data-news-item={item.id}
      data-gainer={item.gainer || undefined}
      data-fresh={fresh || undefined}
      data-news-origin={item.origin}
      data-older={item.older || undefined}
    >
      <p className={styles.meta}>
        <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>
          {relativeTime(item.publishedAt, now)}
        </time>
        {item.source && (
          <span className={styles.source} data-news-source>
            {item.source}
          </span>
        )}
      </p>
      <a className={styles.title} href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      {item.description && <p className={styles.description}>{item.description}</p>}
      {item.tickers.length > 0 && (
        <ul className={styles.tickers} aria-label="Tickers">
          {item.tickers.map((ticker) => (
            <li key={ticker} className={gainers.has(ticker) ? styles.gainerTicker : styles.ticker} data-gainer-ticker={gainers.has(ticker) || undefined}>
              {ticker}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function ChatNewsFeed({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<NewsFeedData | null>(null);
  const [waiting, setWaiting] = useState<NewsFeedData | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<NewsFilter>("all");
  const scroller = useRef<HTMLDivElement | null>(null);
  const shown = useRef<NewsFeedData | null>(null);

  const atTop = () => (scroller.current?.scrollTop ?? 0) <= TOP_SLACK;
  const show = useCallback((next: NewsFeedData) => {
    const added = shown.current ? newItemIds(shown.current.items, next.items) : [];
    shown.current = next;
    setData(next);
    setWaiting(null);
    setFresh(new Set(added));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      fetch("/api/chat/news/feed", { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((body: NewsFeedData) => {
          if (controller.signal.aborted || !Array.isArray(body?.items)) return;
          setFailed(false);
          setNow(Date.now());
          const current = shown.current;
          if (current && JSON.stringify(current) === JSON.stringify(body)) return setWaiting(null);
          // Scrolled down with something new: keep the list still and offer the pill instead.
          if (current && newItemIds(current.items, body.items).length > 0 && !atTop()) return setWaiting(body);
          show(body);
        })
        .catch(() => {
          // A failed re-read keeps what is on screen.
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted && document.visibilityState === "visible") timer = setTimeout(read, READ_EVERY_MS);
        });
    };
    read();
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [show]);

  const pendingCount = data && waiting ? newItemIds(data.items, waiting.items).length : 0;
  const showWaiting = () => {
    if (!waiting) return;
    show(waiting);
    scroller.current?.scrollTo({ top: 0 });
  };
  const onScroll = () => {
    if (waiting && atTop()) show(waiting);
  };

  const rootClass = `${pageStyles.page} ${styles.feed}${compact ? ` ${styles.compact}` : ""}`;
  if (!data)
    return (
      <div className={rootClass}>
        <p className={failed ? pageStyles.error : pageStyles.empty} role="status">
          {failed ? "The News Feed is unavailable right now. Trying again…" : "Opening the News Feed…"}
        </p>
      </div>
    );

  const gainers = new Set(data.gainers);
  const tickerFilter = typeof filter === "object" && gainers.has(filter.ticker) ? filter : null;
  const active: NewsFilter = typeof filter === "object" ? (tickerFilter ?? "all") : filter;
  const items = filterNews(data.items, active);
  const firstMarket = active === "all" ? items.findIndex((item) => !item.gainer) : -1;
  // #387: one stock's chip also lists its releases older than three days, under their own heading.
  const firstOlder = typeof active === "object" ? items.findIndex((item) => item.older) : -1;
  const chips: { filter: NewsFilter; label: string }[] = [
    { filter: "all", label: "All" },
    ...(data.gainers.length ? [{ filter: "gainers" as const, label: "Gainers only" }] : []),
    ...data.gainers.map((ticker) => ({ filter: { ticker }, label: ticker })),
  ];

  return (
    <div className={rootClass} ref={scroller} onScroll={onScroll} data-news-feed>
      <div className={styles.column}>
        {pendingCount > 0 && (
          <div className={styles.pillBar}>
            <button type="button" className={styles.pill} onClick={showWaiting} data-news-new-pill>
              ↑ {pendingCount} new
            </button>
          </div>
        )}
        {!compact && (
          <p className={styles.intro}>
            Every press release for the stocks in today’s Gainers Table comes first (from DilutionTracker and Polygon,
            last three days; pick a stock for its older ones), then the wider market from Polygon and FMP. Newest first,
            refreshes every minute.
          </p>
        )}
        {chips.length > 1 && (
          <div className={styles.chips} role="group" aria-label="Show news for">
            {chips.map((chip) => (
              <button
                key={filterKey(chip.filter)}
                type="button"
                className={styles.chip}
                aria-pressed={filterKey(chip.filter) === filterKey(active)}
                onClick={() => setFilter(chip.filter)}
                data-news-filter={filterKey(chip.filter)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {failed && (
          <p className={pageStyles.error} role="status">
            Couldn’t refresh just now. Trying again…
          </p>
        )}
        {data.partial && !failed && (
          <p className={styles.note} role="status" data-news-partial>
            Some headlines couldn’t be read just now; showing what came back.
          </p>
        )}
        {items.length === 0 ? (
          <p className={pageStyles.empty} data-news-empty>
            No headlines yet.
          </p>
        ) : (
          <div className={styles.list}>
            {items.map((item, index) => (
              <Fragment key={item.id}>
                {active === "all" && index === 0 && item.gainer && <h3 className={styles.section}>Today’s gainers</h3>}
                {index === firstMarket && <h3 className={styles.section}>Market</h3>}
                {index === firstOlder && <h3 className={styles.section}>Older than three days</h3>}
                <Item item={item} now={now} gainers={gainers} fresh={fresh.has(item.id)} />
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
