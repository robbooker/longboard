"use client";
// #386 Booker Stock Club: the card shown in place of a club post's text. It reads the saved pick
// (/api/chat/club/pick), whose country, inst own and borrow are read fresh, and draws a small chart
// of today's 2-minute closes with the levels above price. Until it loads (or if it can't) the post's
// plain text shows instead.
import { useEffect, useState, type ReactNode } from "react";
import { borrowLabel, borrowTitle } from "@/lib/chatGainersBorrow";
import { cashAmount, changeLabel, changeTone, priceLabel, volumeLabel } from "@/lib/chatGainersFacts";
import { countryText, instOwnText, levelPrice, type ClubChart, type ClubPick } from "@/lib/stockClub";
import type { LevelAbove } from "@/lib/stockClubLevels";
import styles from "./StockClubCard.module.css";

const cache = new Map<string, Promise<ClubPick | null>>();
function loadPick(messageId: string) {
  let entry = cache.get(messageId);
  if (!entry) {
    entry = fetch(`/api/chat/club/pick?message=${encodeURIComponent(messageId)}`, { cache: "no-store" })
      .then(async (response) =>
        response.ok ? (((await response.json()) as { pick?: ClubPick }).pick ?? null) : null,
      )
      .catch(() => null);
    // A failure is tried again the next time the card mounts.
    entry.then((pick) => {
      if (!pick) cache.delete(messageId);
    });
    cache.set(messageId, entry);
  }
  return entry;
}

const clock = (at: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));

const W = 320;
const H = 96;
const PAD = 4;

/** Today's closes as a line, with dashed lines for the levels above price that fit near the range. */
function Sparkline({ chart, levels, ticker }: { chart: ClubChart; levels: LevelAbove[]; ticker: string }) {
  const closes = chart.points.map(([, c]) => c);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  // Draw levels up to 60% of the day's range above the high (at least 15% of price), so the line stays readable.
  const reach = high + Math.max((high - low) * 0.6, high * 0.15);
  const shown = levels.filter((level) => level.price <= reach).slice(0, 4);
  const top = Math.max(high, ...shown.map((level) => level.price));
  const span = top - low || top * 0.01 || 1;
  const first = chart.points[0][0];
  const last = Math.max(chart.points[chart.points.length - 1][0], first + 1);
  const x = (minute: number) => PAD + ((minute - first) / (last - first)) * (W - PAD * 2);
  const y = (price: number) => PAD + (1 - (price - low) / span) * (H - PAD * 2);
  const path = chart.points
    .map(([m, c], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(c).toFixed(1)}`)
    .join("");
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${ticker} today in 2-minute closes, from ${levelPrice(closes[0])} to ${levelPrice(closes[closes.length - 1])}`}
      data-club-chart
    >
      {shown.map((level) => (
        <line
          key={`${level.kind}-${level.price}`}
          className={styles[`level_${level.kind}`]}
          x1={0}
          x2={W}
          y1={y(level.price)}
          y2={y(level.price)}
          vectorEffect="non-scaling-stroke"
          data-club-chart-level={level.kind}
        />
      ))}
      <path className={styles.line} d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Field({
  name,
  label,
  children,
  title,
}: {
  name: string;
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div data-club-field={name} title={title}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function StockClubCard({ messageId, fallback }: { messageId: string; fallback: ReactNode }) {
  const [pick, setPick] = useState<ClubPick | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadPick(messageId).then((value) => live && setPick(value));
    return () => {
      live = false;
    };
  }, [messageId]);
  if (!pick) return <>{fallback}</>;
  const quote = { price: pick.price, changePct: pick.changePct, volume: pick.volume };
  const tone = changeTone(quote);
  return (
    <section
      className={styles.card}
      data-club-card={pick.ticker}
      aria-label={`${pick.ticker}, ${pick.source === "admin" ? "today's pick" : "#1 stock of the day"}`}
    >
      <p className={styles.kind}>
        {pick.source === "admin" ? "Today's pick" : "#1 stock of the day"} · {clock(pick.at)} ET
      </p>
      <div className={styles.head}>
        <h3 className={styles.symbol} data-club-field="symbol">
          {pick.ticker}
        </h3>
        <span className={styles.price} data-club-field="price">
          {priceLabel(quote)}
        </span>
        <span className={tone ? styles[tone] : undefined} data-club-field="change">
          {changeLabel(quote)} today
        </span>
      </div>
      {pick.name && <p className={styles.name}>{pick.name}</p>}
      <dl className={styles.facts}>
        <Field name="volume" label="Volume">
          {volumeLabel(quote)}
        </Field>
        <Field name="country" label="Country">
          {countryText(pick.country)}
        </Field>
        <Field name="inst-own" label="Inst own">
          {instOwnText(pick.instOwnPct)}
        </Field>
        <Field name="borrow" label="Borrow at TZ" title={borrowTitle(pick.borrow)}>
          {borrowLabel(pick.borrow)}
        </Field>
        {pick.marketCap ? (
          <Field name="market-cap" label="Market cap">
            {cashAmount(pick.marketCap)}
          </Field>
        ) : null}
      </dl>
      <div className={styles.levels} data-club-levels>
        <p className={styles.levelsTitle}>Levels above price</p>
        {pick.levels.length ? (
          <ul>
            {pick.levels.slice(0, 6).map((level) => (
              <li key={`${level.kind}-${level.price}`} data-club-level={level.kind}>
                <span className={styles.levelPrice}>{levelPrice(level.price)}</span>
                <span className={styles[`tag_${level.kind}`]}>{level.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.none}>No missed pivots, monthly pivot or 200 SMA above price.</p>
        )}
      </div>
      {pick.chart && pick.chart.points.length > 1 && (
        <Sparkline chart={pick.chart} levels={pick.levels} ticker={pick.ticker} />
      )}
    </section>
  );
}
