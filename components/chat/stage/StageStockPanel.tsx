"use client";
// #501: "On screen now": one stock at a time, from today's Gainers Table (the same read as the
// Gainers Table page, /api/chat/gainers/table, every 15 seconds while the tab is shown) with its
// press releases from the last 30 days (/api/chat/gainers/news). When the table has no rows to
// show, the handoff's saved APUS row stands in, marked as a sample; made-up tickers show "—".
import { useEffect, useState } from "react";
import type { GainersTableData, GainersTableRow } from "@/lib/chatGainersFacts";
import { parseRowNewsData, rowNewsTime, ROW_NEWS_EMPTY, type GainersRowNewsItem } from "@/lib/chatGainersRowNews";
import { stageOnScreen, stageStocks } from "@/lib/chatStageMode";
import styles from "./StageMode.module.css";

const READ_EVERY_MS = 15_000;

/** Today's Gainers Table rows (null while it can't be read), and whether the first read has answered. */
function useGainersRows() {
  const [rows, setRows] = useState<GainersTableRow[] | null>(null);
  const [answered, setAnswered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      fetch("/api/chat/gainers/table", { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((body: GainersTableData) => {
          if (controller.signal.aborted || !Array.isArray(body?.rows)) return;
          setNow(Date.now());
          setRows((current) => (JSON.stringify(current) === JSON.stringify(body.rows) ? current : body.rows));
        })
        .catch(() => undefined)
        .finally(() => {
          if (controller.signal.aborted) return;
          setAnswered(true);
          timer = setTimeout(read, READ_EVERY_MS);
        });
    };
    read();
    const shown = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, []);
  return { rows, now, answered };
}

type News = { sym: string; status: "loading" | "ready" | "failed"; items: GainersRowNewsItem[] };

/** One stock's saved press releases; nothing is read for a made-up ticker. */
function usePressReleases(sym: string, real: boolean) {
  const [news, setNews] = useState<News | null>(null);
  useEffect(() => {
    if (!real) return;
    const controller = new AbortController();
    setNews({ sym, status: "loading", items: [] });
    fetch(`/api/chat/gainers/news?ticker=${encodeURIComponent(sym)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: unknown) => {
        const items = parseRowNewsData(body, sym);
        if (!items) throw new Error("bad answer");
        setNews({ sym, status: "ready", items });
      })
      .catch(() => {
        if (!controller.signal.aborted) setNews({ sym, status: "failed", items: [] });
      });
    return () => controller.abort();
  }, [sym, real]);
  return real && news?.sym === sym ? news : null;
}

export default function StageStockPanel({
  onScreen,
  onSelect,
}: {
  /** The ticker on screen. Local for now; later an admin action or a realtime event sets it for the room. */
  onScreen: string | null;
  onSelect: (sym: string) => void;
}) {
  const { rows, now, answered } = useGainersRows();
  const stocks = stageStocks(rows, now);
  const stock = stageOnScreen(stocks, onScreen);
  const real = stock.source !== "placeholder";
  const news = usePressReleases(stock.sym, real && answered);
  // Before the first read answers there is nothing to show yet: no sample flashes ahead of real rows.
  if (!answered)
    return (
      <section className={styles.stock} aria-label="On screen now" aria-busy="true" data-stage-stock="" data-stage-stock-source="loading">
        <div className={styles.stockHead}>
          <h2 className={styles.label}>On screen now</h2>
        </div>
        <p className={styles.newsNote} role="status">
          Reading today’s Gainers Table…
        </p>
      </section>
    );
  return (
    <section className={styles.stock} aria-label="On screen now" data-stage-stock={stock.sym} data-stage-stock-source={stock.source}>
      <div className={styles.stockHead}>
        <h2 className={styles.label}>On screen now</h2>
        <span className={`${styles.mono} ${styles.stockSym}`} data-stage-stock-sym>
          {stock.sym}
        </span>
        {stock.market && <span className={styles.marketTag}>{stock.market}</span>}
        {stock.source !== "table" && (
          <span className={styles.sampleTag} data-stage-sample>
            {stock.source === "sample" ? "Sample row · Nov 25" : "Sample ticker"}
          </span>
        )}
        <span className={styles.spacer} />
        <div className={styles.chips} role="group" aria-label="Stock on screen">
          {stocks.map((option) => (
            <button
              key={option.sym}
              type="button"
              className={`${styles.chip} ${styles.mono}`}
              aria-pressed={option.sym === stock.sym}
              data-stage-chip={option.sym}
              onClick={() => onSelect(option.sym)}
            >
              {option.sym}
            </button>
          ))}
        </div>
        <a className={styles.link} href="/chat?page=gainers-table" target="_blank" rel="noopener noreferrer">
          From the Gainers Table in #gainers
        </a>
      </div>
      <div className={styles.statsScroll}>
        <dl className={styles.stats}>
          {stock.stats.map((stat) => (
            <div key={stat.key} className={styles.stat} data-stage-stat={stat.key}>
              <dt>{stat.name}</dt>
              <dd className={styles.mono} data-tone={stat.tone}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={styles.news} data-stage-news={news?.status ?? (real ? "loading" : "none")}>
        <h3 className={styles.newsHead}>Press releases · last 30 days</h3>
        {!real ? (
          <p className={styles.newsNote}>A made-up ticker for this mock-up: nothing to show.</p>
        ) : news?.status === "failed" ? (
          <p className={styles.newsNote} role="status">
            Couldn’t load the press releases just now.
          </p>
        ) : news?.status === "ready" && news.items.length === 0 ? (
          <p className={styles.newsNote}>{ROW_NEWS_EMPTY}</p>
        ) : news?.status === "ready" ? (
          <ol className={styles.newsList}>
            {news.items.slice(0, 5).map((item) => (
              <li key={item.key} data-stage-news-item>
                <time className={styles.mono} dateTime={item.publishedAt}>
                  {rowNewsTime(item.publishedAt, now)}
                </time>
                <a className={styles.link} href={item.url} target="_blank" rel="noopener noreferrer" title={item.title}>
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.newsNote} role="status">
            Loading press releases…
          </p>
        )}
      </div>
    </section>
  );
}
