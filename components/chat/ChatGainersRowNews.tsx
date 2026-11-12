"use client";
// #437: a Gainers Table row's press releases from the last 30 days, newest first: time (Eastern),
// wire, and the headline as a link that opens the release in a new tab. On a computer it is the
// panel right under the clicked row; on a phone it sits in the row's details, below the facts.
// Read from /api/chat/gainers/news each time a row opens (DilutionTracker's saved releases only).
// Everything is React text; the links are checked as http(s) on the server and again here.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROW_NEWS_EMPTY,
  parseRowNewsData,
  rowNewsTime,
  type GainersRowNewsItem,
} from "@/lib/chatGainersRowNews";
import styles from "./ChatGainersTable.module.css";

export type RowNewsState =
  | { status: "loading"; items?: GainersRowNewsItem[] }
  | { status: "ready"; items: GainersRowNewsItem[] }
  | { status: "failed"; items?: GainersRowNewsItem[] };

/** Each opened row's releases, and the read that loads (or reloads) one. */
export function useGainersRowNews() {
  const [news, setNews] = useState<Record<string, RowNewsState>>({});
  const reads = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const current = reads.current;
    return () => current.forEach((controller) => controller.abort());
  }, []);
  const load = useCallback((sym: string) => {
    reads.current.get(sym)?.abort();
    const controller = new AbortController();
    reads.current.set(sym, controller);
    setNews((all) => ({ ...all, [sym]: { status: "loading", items: all[sym]?.items } }));
    fetch(`/api/chat/gainers/news?ticker=${encodeURIComponent(sym)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: unknown) => {
        const items = parseRowNewsData(body, sym);
        if (!items) throw new Error("bad answer");
        setNews((all) => ({ ...all, [sym]: { status: "ready", items } }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setNews((all) => ({ ...all, [sym]: { status: "failed", items: all[sym]?.items } }));
      })
      .finally(() => {
        if (reads.current.get(sym) === controller) reads.current.delete(sym);
      });
  }, []);
  return [news, load] as const;
}

export default function GainersRowNews({
  sym,
  state,
  now,
  phone = false,
}: {
  sym: string;
  state: RowNewsState | undefined;
  now: number;
  phone?: boolean;
}) {
  const items = state?.items;
  return (
    <section
      className={phone ? `${styles.rowNews} ${styles.rowNewsPhone}` : styles.rowNews}
      aria-label={`${sym} press releases, last 30 days`}
      data-row-news={sym}
      data-row-news-status={state?.status ?? "loading"}
    >
      <h3 className={styles.rowNewsHead}>Press releases · last 30 days</h3>
      {items && items.length > 0 ? (
        <ol className={styles.rowNewsList}>
          {items.map((item) => (
            <li key={item.key} data-row-news-item>
              <time className={styles.rowNewsTime} dateTime={item.publishedAt} data-row-news-time>
                {rowNewsTime(item.publishedAt, now)}
              </time>
              <span className={styles.rowNewsWire} data-row-news-wire>
                {item.source || "—"}
              </span>
              <a
                className={styles.rowNewsLink}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                data-row-news-link
                onClick={(event) => event.stopPropagation()}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ol>
      ) : state?.status === "ready" ? (
        <p className={styles.rowNewsNote} data-row-news-empty>
          {ROW_NEWS_EMPTY}
        </p>
      ) : state?.status === "failed" ? null : (
        <p className={`${styles.rowNewsNote} ${styles.lookingUp}`} role="status">
          Loading press releases…
        </p>
      )}
      {state?.status === "failed" && (
        <p className={styles.rowNewsError} role="status" data-row-news-failed>
          Couldn’t load the press releases just now. Close and open the row to try again.
        </p>
      )}
    </section>
  );
}
