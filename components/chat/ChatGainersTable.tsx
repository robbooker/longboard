"use client";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  CFP,
  CFP_WORDS,
  GAINERS_COLUMNS,
  GAINERS_DETAIL_COLUMNS,
  GAINERS_PHONE_COLUMNS,
  cashLabel,
  changeLabel,
  changeTone,
  countryLabel,
  instOwnLabel,
  isLookingUp,
  minutesSince,
  priceLabel,
  splitCfp,
  volumeLabel,
  type GainersColumnKey,
  type GainersTableData,
  type GainersTableRow,
} from "@/lib/chatGainersFacts";
import { BORROW_CHECKING, borrowLabel, borrowTitle } from "@/lib/chatGainersBorrow";
import { ibAvailLabel, ibFeeLabel, ibNoneToLend, ibTitle } from "@/lib/chatGainersIb";
import { GainersHead, GainersIconKey } from "./ChatGainersTableHead";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatGainersTable.module.css";

// #371 Gainers Table: a channel that is a table, not messages. One row per stock that alerted in
// the Gainers room today (Eastern), newest alert first, with its country, cash left and
// institutional ownership. Facts the lookup hasn't saved yet show "looking up…" and fill in on a
// later read. New alerts and facts arrive by reading again every 15 seconds while the tab is shown;
// the minutes count up on their own in between.
// #372: price, % today (green up, red down) and volume today from Polygon's snapshot, refreshed on
// the same 15-second read; "—" when the snapshot couldn't be read.
// #373: Borrow at TZ, TradeZero's cost to borrow per share: "ETB", "$0.04", "None", or "checking…"
// before the first check; the cell's title says when it was checked ("checked 9:42").
// #376: IB overnight fee (annual %) and IB avail (shares Interactive Brokers can lend) right after
// Borrow at TZ, from IB's public file; the title says when IB wrote it. A phone (720px or less)
// shows only Symbol, % today, Volume and Borrow at TZ, with no sideways scroll; tapping a stock
// opens a details line under it with the rest, Price first. Open rows stay open across the 15-second reads.
// #394: Cash left says "CFP" for cash flow positive; hovering it (title) or tapping it shows "Cash Flow Positive".
// #398: a phone's row shows Symbol, Price, % today, Country and Borrow at TZ (Rob's most important
// columns, in that order); the rest (Volume, IB overnight fee, IB avail, Min since alert, Cash left,
// Inst Own %) are in the details, each with its name beside it. A computer's table is as before.
// The columns live in lib/chatGainersFacts.ts (GAINERS_COLUMNS, GAINERS_PHONE_COLUMNS).

const PHONE_QUERY = "(max-width: 720px)";

const READ_EVERY_MS = 15_000;
const TICK_MS = 5_000;

function Fact({ label }: { label: string }) {
  const waiting = isLookingUp(label);
  return (
    <span className={waiting ? styles.lookingUp : undefined} data-looking-up={waiting || undefined}>
      {label}
    </span>
  );
}

/** #394: "CFP", which says "Cash Flow Positive" on hover (title) and to screen readers (aria-label), and
 * shows the words under it when tapped or clicked (tap again, tap elsewhere or Escape hides them). Its
 * tap never reaches the row, so it doesn't open or close a phone row's details. */
function Cfp() {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  useEffect(() => {
    if (!shown) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setShown(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [shown]);
  return (
    <span ref={ref} className={styles.cfp} data-cfp={shown ? "shown" : "hidden"}>
      <button
        type="button"
        className={styles.cfpButton}
        title={CFP_WORDS}
        aria-label={CFP_WORDS}
        aria-expanded={shown}
        aria-describedby={shown ? tipId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setShown((current) => !current);
        }}
      >
        <abbr title={CFP_WORDS}>{CFP}</abbr>
      </button>
      {shown && (
        <span id={tipId} role="tooltip" className={styles.cfpWords} data-cfp-words>
          {CFP_WORDS}
        </span>
      )}
    </span>
  );
}

/** The cash left value: like Fact, with its "CFP" (if any) as Cfp. */
function CashFact({ label }: { label: string }) {
  const { before, cfp } = splitCfp(label);
  if (!cfp) return <Fact label={label} />;
  return (
    <span>
      {before}
      <Cfp />
    </span>
  );
}

/** Whether the screen is phone width (the same 720px as the stylesheet). */
function usePhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

type Cell = { className?: string; attrs?: Record<string, string | number | undefined>; content: ReactNode };

/** One value of a row: its classes and data attributes (the same in the row and in a phone's details). */
function cell(
  key: GainersColumnKey,
  row: GainersTableRow,
  minutes: number,
  now: number,
  phone: boolean,
): Cell {
  switch (key) {
    case "price":
      return { attrs: { "data-price": "" }, content: priceLabel(row.quote) };
    case "change": {
      const tone = changeTone(row.quote);
      return {
        className: tone === "up" ? styles.up : tone === "down" ? styles.down : undefined,
        attrs: { "data-change": tone ?? undefined },
        content: changeLabel(row.quote),
      };
    }
    case "volume":
      return { attrs: { "data-volume": "" }, content: volumeLabel(row.quote) };
    case "borrow": {
      const borrow = borrowLabel(row.borrow);
      return {
        attrs: { "data-borrow": row.borrow?.status ?? "checking", title: borrowTitle(row.borrow) },
        content: borrow === BORROW_CHECKING ? <span className={styles.lookingUp}>{borrow}</span> : borrow,
      };
    }
    case "ibFee":
      return { attrs: { "data-ib-fee": "", title: ibTitle(row.ib, now) }, content: ibFeeLabel(row.ib) };
    case "ibAvail":
      return {
        className: ibNoneToLend(row.ib) ? styles.noneToLend : undefined,
        attrs: {
          "data-ib-avail": ibNoneToLend(row.ib) ? "none" : row.ib ? "some" : "unknown",
          title: ibTitle(row.ib, now),
        },
        content: ibAvailLabel(row.ib),
      };
    case "minutes":
      return { attrs: { "data-minutes": minutes }, content: minutes };
    case "country": {
      const label = countryLabel(row);
      // #398: on a phone a long name wraps to two lines at most; the title has it whole.
      return {
        className: phone ? styles.country : undefined,
        attrs: { "data-country": "", title: phone && !isLookingUp(label) ? label : undefined },
        content: <Fact label={label} />,
      };
    }
    case "cash":
      return { attrs: { "data-cash": "" }, content: <CashFact label={cashLabel(row)} /> };
    case "instOwn":
      return { content: <Fact label={instOwnLabel(row)} /> };
  }
}

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ") || undefined;

export default function ChatGainersTable() {
  const [data, setData] = useState<GainersTableData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const phone = usePhone();
  // #398: a phone's row has its own columns, in its own order; the rest go in the details.
  const columns = phone ? GAINERS_PHONE_COLUMNS : GAINERS_COLUMNS;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      fetch("/api/chat/gainers/table", { cache: "no-store", signal: controller.signal })
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
        )
        .then((body: GainersTableData) => {
          if (controller.signal.aborted || !Array.isArray(body?.rows)) return;
          setFailed(false);
          setNow(Date.now());
          // Nothing changed: keep the same object, so the table doesn't redraw for a re-read.
          setData((current) => (JSON.stringify(current) === JSON.stringify(body) ? current : body));
        })
        .catch(() => {
          // A failed re-read keeps what is on screen.
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted && document.visibilityState === "visible")
            timer = setTimeout(read, READ_EVERY_MS);
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
  }, []);

  const toggle = (sym: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(sym)) next.add(sym);
      return next;
    });

  if (!data)
    return (
      <div className={pageStyles.page}>
        <p className={failed ? pageStyles.error : pageStyles.empty} role="status">
          {failed
            ? "The Gainers Table is unavailable right now. Trying again…"
            : "Opening the Gainers Table…"}
        </p>
      </div>
    );

  return (
    <div className={pageStyles.page} data-gainers-table data-day={data.day}>
      <div className={styles.column}>
        <p className={styles.intro}>
          Every stock that alerted in Gainers today with at least 150,000 shares (pre-market and regular
          hours), newest alert first. Company facts from DilutionTracker; borrow cost per share from
          TradeZero; overnight borrow fee and shares available from Interactive Brokers.
          <span className={styles.phoneOnly}> Tap a stock for the rest.</span>
        </p>
        {data.rows.length > 0 && (
          <GainersIconKey columns={GAINERS_PHONE_COLUMNS.map(({ key, name }) => [key, name])} />
        )}
        {failed && (
          <p className={pageStyles.error} role="status">
            Couldn’t refresh just now. Trying again…
          </p>
        )}
        {data.rows.length === 0 ? (
          <p className={pageStyles.empty} data-gainers-table-empty>
            No gainers have alerted yet today.
          </p>
        ) : (
          <div className={styles.frame}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.symbol}>
                    Symbol
                  </th>
                  {columns.map(({ key, name, number, title }) => (
                    <GainersHead key={key} icon={key} name={name} title={title} number={number} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const minutes = minutesSince(row.lastAlertAt, now);
                  const expanded = phone && open.has(row.sym);
                  const detailsId = `gainers-details-${row.sym.replace(/[^A-Z]/g, "_")}`;
                  return (
                    <Fragment key={row.sym}>
                      {/* On a phone the whole row is the tap target; the symbol's button (same click) is the
                          keyboard and screen-reader way in. */}
                      <tr
                        data-gainers-row={row.sym}
                        data-open={expanded || undefined}
                        className={phone ? styles.tappable : undefined}
                        onClick={phone ? () => toggle(row.sym) : undefined}
                      >
                        <th scope="row" className={styles.symbol}>
                          {phone ? (
                            <button
                              type="button"
                              className={styles.rowToggle}
                              aria-expanded={expanded}
                              aria-controls={expanded ? detailsId : undefined}
                              aria-label={`${row.sym}: ${expanded ? "hide" : "show"} details`}
                              data-gainers-toggle={row.sym}
                            >
                              <span className={styles.chevron} aria-hidden="true">
                                {expanded ? "▾" : "▸"}
                              </span>
                              {row.sym}
                            </button>
                          ) : (
                            row.sym
                          )}
                        </th>
                        {columns.map(({ key, number }) => {
                          const { className, attrs, content } = cell(key, row, minutes, now, phone);
                          return (
                            <td key={key} className={classes(number && styles.number, className)} {...attrs}>
                              {content}
                            </td>
                          );
                        })}
                      </tr>
                      {expanded && (
                        <tr className={styles.detailsRow} data-gainers-details={row.sym}>
                          <td colSpan={columns.length + 1} id={detailsId}>
                            <dl className={styles.details}>
                              {GAINERS_DETAIL_COLUMNS.map(({ key, name }) => {
                                const { className, attrs, content } = cell(key, row, minutes, now, phone);
                                return (
                                  <div key={key} data-detail={key}>
                                    <dt>{name}</dt>
                                    <dd>
                                      <span className={className} {...attrs}>
                                        {content}
                                      </span>
                                    </dd>
                                  </div>
                                );
                              })}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
