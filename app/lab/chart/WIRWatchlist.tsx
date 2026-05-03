"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GapEvent, WIRSortKey, SortDir, WIRWeek } from "@/lib/wir/types";
import {
  buildDayTabs,
  filterByDay,
  sortEvents,
  nextSort,
  formatGapPct,
  formatVolume,
  formatLongScore,
  DEFAULT_SORT,
} from "@/lib/wir/sort";

type Props = {
  week: WIRWeek;
  /** The currently-loaded ticker on the chart, for row highlight. */
  activeTicker?: string;
  /** Current resolution param, preserved on row clicks. */
  res?: "1m" | "5m";
};

/**
 * WIR Watchlist
 *
 * Replaces the live-gainers panel on /lab/chart with the full ~94-event
 * gap universe from the most recent Week-in-Review report. Day tabs
 * scope to a single session; column headers sort.
 *
 * Click on a row -> /lab/chart?ticker=<sym>&date=<gap_date>&res=<res>.
 * We set both ticker AND date because the chart should show the day the
 * gap fired, not most-recent-trading-day.
 *
 * Editorial palette (from app/lab/chart/chart.css):
 *   - Positive gap_pct shown in --lab-gold (NOT --lab-up green) per
 *     research-surface convention.
 *   - Symbol in --lab-ink, mono.
 *   - Volume + score in mono, muted.
 */
export default function WIRWatchlist({ week, activeTicker, res = "1m" }: Props) {
  const [dayKey, setDayKey] = useState<"all" | string>("all");
  const [sort, setSort] = useState(DEFAULT_SORT);

  const tabs = useMemo(() => buildDayTabs(week.events), [week.events]);
  const visibleEvents = useMemo(() => {
    const filtered = filterByDay(week.events, dayKey);
    return sortEvents(filtered, sort.key, sort.dir);
  }, [week.events, dayKey, sort]);

  const handleSort = (key: WIRSortKey) => setSort((s) => nextSort(s, key));

  return (
    <aside className="wir-watchlist" aria-label="Week in Review watchlist">
      <header className="wir-watchlist__header">
        <p className="wir-watchlist__eyebrow">Week in Review</p>
        <h2 className="wir-watchlist__title">{week.label}</h2>
        <p className="wir-watchlist__subtitle">
          {week.events.length} gap events &middot; click a row to load chart
        </p>
      </header>

      <nav
        className="wir-watchlist__tabs"
        role="tablist"
        aria-label="Filter by day"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={dayKey === tab.key}
            className={`wir-watchlist__tab${dayKey === tab.key ? " is-active" : ""}`}
            onClick={() => setDayKey(tab.key)}
            type="button"
          >
            <span className="wir-watchlist__tab-label">{tab.label}</span>
            <span className="wir-watchlist__tab-count">{tab.count}</span>
          </button>
        ))}
      </nav>

      <div
        className="wir-watchlist__table-scroll"
        role="region"
        aria-label="Gap events"
      >
        <table className="wir-watchlist__table">
          <thead>
            <tr>
              <SortHeader
                label="Symbol"
                column="symbol"
                sort={sort}
                onSort={handleSort}
                align="left"
              />
              <SortHeader
                label="Gap %"
                column="gap_pct"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
              <SortHeader
                label="Volume"
                column="volume"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
              <SortHeader
                label="Score"
                column="long_score"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((ev) => (
              <WIRRow
                key={`${ev.ticker}-${ev.gap_date}`}
                event={ev}
                isActive={
                  !!activeTicker && ev.ticker === activeTicker.toUpperCase()
                }
                res={res}
              />
            ))}
            {visibleEvents.length === 0 && (
              <tr>
                <td colSpan={4} className="wir-watchlist__empty">
                  No events for this day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align,
}: {
  label: string;
  column: WIRSortKey;
  sort: { key: WIRSortKey; dir: SortDir };
  onSort: (k: WIRSortKey) => void;
  align: "left" | "right";
}) {
  const active = sort.key === column;
  const arrow = active ? (sort.dir === "asc" ? "▲" : "▼") : "";
  return (
    <th
      scope="col"
      className={`wir-watchlist__th wir-watchlist__th--${align}${active ? " is-active" : ""}`}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className="wir-watchlist__sort-btn"
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <span className="wir-watchlist__sort-arrow" aria-hidden="true">
          {arrow}
        </span>
      </button>
    </th>
  );
}

function WIRRow({
  event,
  isActive,
  res,
}: {
  event: GapEvent;
  isActive: boolean;
  res: "1m" | "5m";
}) {
  const href = `/lab/chart?ticker=${encodeURIComponent(
    event.ticker
  )}&date=${encodeURIComponent(event.gap_date)}&res=${res}`;
  return (
    <tr className={`wir-watchlist__row${isActive ? " is-active" : ""}`}>
      <td className="wir-watchlist__cell wir-watchlist__cell--symbol">
        <Link href={href} prefetch={false} className="wir-watchlist__link">
          {event.ticker}
        </Link>
      </td>
      <td className="wir-watchlist__cell wir-watchlist__cell--num wir-watchlist__cell--gap">
        {formatGapPct(event.gap_pct)}
      </td>
      <td className="wir-watchlist__cell wir-watchlist__cell--num">
        {formatVolume(event.volume)}
      </td>
      <td className="wir-watchlist__cell wir-watchlist__cell--num">
        {formatLongScore(event.long_score)}
      </td>
    </tr>
  );
}
