"use client";
// #501: "On screen now": one stock at a time, from today's Gainers Table (the same read as the
// Gainers Table page, /api/chat/gainers/table, every 15 seconds while the tab is shown) with its
// press releases from the last 30 days (/api/chat/gainers/news). When the table has no rows to
// show, the handoff's saved APUS row stands in, marked as a sample; made-up tickers show "—".
// #507: the host can put one stock on screen for everyone (a chip, or any ticker typed in). Everyone
// watching then sees that stock here; a member's own click on a chip changes only their own view.
// A stock that is not on today's table shows only what Polygon says (/api/chat/stage/stock) and "—"
// for the rest. Nothing in the panel says where a number comes from (the owner's rule).
import { useEffect, useState } from "react";
import type { GainersTableData, GainersTableRow } from "@/lib/chatGainersFacts";
import type { ChatRoom } from "@/lib/publicChat";
import { parseRowNewsData, rowNewsTime, ROW_NEWS_EMPTY, type GainersRowNewsItem } from "@/lib/chatGainersRowNews";
import { parseStageLookup, stagePanelView, type StageLookup } from "@/lib/chatStageMode";
import StageOnScreenControl, { type StageHostControls } from "./StageOnScreenControl";
import styles from "./StageMode.module.css";

const READ_EVERY_MS = 15_000;
/** #512: the server said this account is asking too often (429): the next lookup waits this long. */
const LOOKUP_BACKOFF_MS = 60_000;
/** #523: the server does not (yet) have that stock as the one on screen (409): asked again this soon. */
const LOOKUP_NOT_YET_MS = 5_000;
/** #523: signed out, or not allowed to read it: asking again every 15 seconds would change nothing. */
const refused = (status: number) => status === 401 || status === 403;

/**
 * Today's Gainers Table rows (null while it can't be read), and whether the first read has answered.
 * #523: nothing is asked for a member who cannot read the Gainers data (`allowed` false), and the
 * reads stop for good once the server refuses one (401 or 403).
 */
function useGainersRows(allowed: boolean) {
  const [rows, setRows] = useState<GainersTableRow[] | null>(null);
  const [answered, setAnswered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!allowed) return setAnswered(true);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const read = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      fetch("/api/chat/gainers/table", { cache: "no-store", signal: controller.signal })
        .then((response) => {
          if (refused(response.status)) stopped = true;
          return response.ok ? response.json() : Promise.reject(new Error(String(response.status)));
        })
        .then((body: GainersTableData) => {
          if (controller.signal.aborted || !Array.isArray(body?.rows)) return;
          setNow(Date.now());
          setRows((current) => (JSON.stringify(current) === JSON.stringify(body.rows) ? current : body.rows));
        })
        .catch(() => undefined)
        .finally(() => {
          if (controller.signal.aborted) return;
          setAnswered(true);
          if (!stopped) timer = setTimeout(read, READ_EVERY_MS);
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
  }, [allowed]);
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

/**
 * #507: Polygon's numbers for a stock that is not on today's table, read like the table itself
 * (every 15 seconds while the tab is shown). Nothing is asked while `sym` is null.
 * #523: asked for the room's stage (the server answers only for the stock on screen there), and
 * the reads stop for good once the server refuses one (401 or 403).
 */
function useStockLookup(room: ChatRoom, sym: string | null) {
  const [found, setFound] = useState<{ sym: string; lookup: StageLookup } | null>(null);
  useEffect(() => {
    if (!sym) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const read = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      let wait = READ_EVERY_MS;
      fetch(`/api/chat/stage/stock?room=${encodeURIComponent(room)}&ticker=${encodeURIComponent(sym)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => {
          // Refused (too many lookups) or failed: the panel keeps what it has, or shows dashes.
          if (response.status === 429) wait = LOOKUP_BACKOFF_MS;
          else if (response.status === 409) wait = LOOKUP_NOT_YET_MS;
          else if (refused(response.status)) stopped = true;
          return response.ok ? response.json() : null;
        })
        .then((body: unknown) => {
          const lookup = parseStageLookup(body, sym);
          if (!controller.signal.aborted && lookup) setFound({ sym, lookup });
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted && !stopped) timer = setTimeout(read, wait);
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
  }, [room, sym]);
  return sym && found?.sym === sym ? found.lookup : null;
}

export default function StageStockPanel({
  room,
  gainers,
  host,
  picked,
  onPick,
  samples,
  controls,
}: {
  /** The room whose stage this is. */
  room: ChatRoom;
  /** #523: this member can read the Gainers data. Without it nothing is asked of the table or the lookup. */
  gainers: boolean;
  /** #507: the stock the host put on screen for everyone (null: none). */
  host: string | null;
  /** This viewer's own choice of chip (null: whatever is on screen). Never leaves this device. */
  picked: string | null;
  onPick: (sym: string | null) => void;
  /** #502: admins only. Without it (members) nothing made up is shown: no rows today, no panel. */
  samples: boolean;
  /** #507: admins only: a click on a chip, and the typed box, set the stock for everyone. */
  controls?: StageHostControls;
}) {
  const { rows, now, answered } = useGainersRows(gainers);
  const none = !rows?.length;
  const offTable = !!host && answered && !rows?.some((row) => row.sym === host);
  const lookup = useStockLookup(room, gainers && offTable && (!picked || picked === host) ? host : null);
  const view = stagePanelView({ rows, now, host, picked, samples, lookup });
  const stock = view.stock;
  const real = !!stock && (stock.source === "table" || stock.source === "lookup");
  const news = usePressReleases(stock?.sym ?? "", real && answered);
  // #502: a member sees real rows only. No rows (or a table they cannot read) and nothing put on
  // screen by the host: the panel is left out.
  if (!samples && (!answered || (none && !host))) return null;
  // Before the first read answers there is nothing to show yet: no sample flashes ahead of real rows.
  if (!answered || !stock)
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
  // The host's chip leads the row when the stock is not one of today's chips.
  const chips: readonly { sym: string; source?: string }[] =
    host && !view.chips.some((option) => option.sym === host) ? [{ sym: host }, ...view.chips] : view.chips;
  const setsForAll = !!controls?.ready;
  const choose = (sym: string, source?: string) => {
    // The host's click on one of today's stocks puts it on screen for everyone; a member's click (and
    // anyone's on a sample chip) changes only their own view. The host's own chip is the way back.
    if (sym === host) onPick(null);
    else if (setsForAll && source === "table") void controls.set(sym);
    else onPick(sym);
  };
  const browsing = !!host && !view.following;
  return (
    <section
      className={styles.stock}
      aria-label="On screen now"
      data-stage-stock={stock.sym}
      data-stage-stock-source={stock.source}
      data-stage-host={host ?? ""}
      data-stage-following={view.following || undefined}
    >
      <div className={styles.stockHead}>
        <h2 className={styles.label}>{browsing ? "You’re looking at" : "On screen now"}</h2>
        <span className={`${styles.mono} ${styles.stockSym}`} data-stage-stock-sym>
          {stock.sym}
        </span>
        {stock.market && <span className={styles.marketTag}>{stock.market}</span>}
        {(stock.source === "sample" || stock.source === "placeholder") && (
          <span className={styles.sampleTag} data-stage-sample>
            {stock.source === "sample" ? "Sample row · Nov 25" : "Sample ticker"}
          </span>
        )}
        {browsing && (
          <button type="button" className={styles.nowButton} data-stage-now onClick={() => onPick(null)}>
            Now on screen: <span className={styles.mono}>{host}</span>
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div
          className={styles.chips}
          role="group"
          aria-label={setsForAll ? "Put a stock on screen for everyone" : host ? "Look at another stock (only you see this)" : "Stock on screen"}
        >
          {chips.map((option) => (
            <button
              key={option.sym}
              type="button"
              className={`${styles.chip} ${styles.mono}`}
              aria-pressed={option.sym === stock.sym}
              data-stage-chip={option.sym}
              data-stage-chip-on-screen={option.sym === host || undefined}
              disabled={setsForAll && controls.busy}
              onClick={() => choose(option.sym, option.source)}
            >
              {option.sym}
              {option.sym === host && <span className={styles.chipOn}>On screen</span>}
            </button>
          ))}
        </div>
      )}
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
      {/* A stock that is not on today's table: its saved press releases when there are any, otherwise
          no press-release section at all (none were collected, so "none in 30 days" would be a claim). */}
      {!(stock.source === "lookup" && !(news?.status === "ready" && news.items.length > 0)) && (
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
      )}
      {controls && <StageOnScreenControl host={host} controls={controls} />}
    </section>
  );
}
