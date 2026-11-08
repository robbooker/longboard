"use client";
import { useEffect, useState } from "react";
import {
  cashLabel,
  changeLabel,
  changeTone,
  countryLabel,
  instOwnLabel,
  isLookingUp,
  minutesSince,
  priceLabel,
  volumeLabel,
  type GainersTableData,
} from "@/lib/chatGainersFacts";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatGainersTable.module.css";

// #371 Gainers Table: a channel that is a table, not messages. One row per stock that alerted in
// the Gainers room today (Eastern), newest alert first, with its country, cash left and
// institutional ownership. Facts the lookup hasn't saved yet show "looking up…" and fill in on a
// later read. New alerts and facts arrive by reading again every 15 seconds while the tab is shown;
// the minutes count up on their own in between.
// #372: price, % today (green up, red down) and volume today from Polygon's snapshot, refreshed on
// the same 15-second read; "—" when the snapshot couldn't be read. On a phone the table scrolls
// sideways inside its frame with the symbol pinned, so the page itself never does.

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

export default function ChatGainersTable() {
  const [data, setData] = useState<GainersTableData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      fetch("/api/chat/gainers/table", { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
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
  }, []);

  if (!data)
    return (
      <div className={pageStyles.page}>
        <p className={failed ? pageStyles.error : pageStyles.empty} role="status">
          {failed ? "The Gainers Table is unavailable right now. Trying again…" : "Opening the Gainers Table…"}
        </p>
      </div>
    );

  return (
    <div className={pageStyles.page} data-gainers-table data-day={data.day}>
      <div className={styles.column}>
        <p className={styles.intro}>
          Every stock that alerted in Gainers today with at least 150,000 shares (pre-market and regular hours),
          newest alert first. Company facts from DilutionTracker.
        </p>
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
                  <th scope="col" className={styles.number}>
                    Price
                  </th>
                  <th scope="col" className={styles.number}>
                    % today
                  </th>
                  <th scope="col" className={styles.number}>
                    Volume
                  </th>
                  <th scope="col" className={styles.number}>
                    Min since alert
                  </th>
                  <th scope="col">Country</th>
                  <th scope="col">Cash left</th>
                  <th scope="col" className={styles.number}>
                    Inst Own %
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const minutes = minutesSince(row.lastAlertAt, now);
                  const tone = changeTone(row.quote);
                  return (
                    <tr key={row.sym} data-gainers-row={row.sym}>
                      <th scope="row" className={styles.symbol}>
                        {row.sym}
                      </th>
                      <td className={styles.number} data-price>
                        {priceLabel(row.quote)}
                      </td>
                      <td
                        className={`${styles.number} ${tone === "up" ? styles.up : tone === "down" ? styles.down : ""}`}
                        data-change={tone ?? undefined}
                      >
                        {changeLabel(row.quote)}
                      </td>
                      <td className={styles.number} data-volume>
                        {volumeLabel(row.quote)}
                      </td>
                      <td className={styles.number} data-minutes={minutes}>
                        {minutes}
                      </td>
                      <td>
                        <Fact label={countryLabel(row)} />
                      </td>
                      <td data-cash>
                        <Fact label={cashLabel(row)} />
                      </td>
                      <td className={styles.number}>
                        <Fact label={instOwnLabel(row)} />
                      </td>
                    </tr>
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
