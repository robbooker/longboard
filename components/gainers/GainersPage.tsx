import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import GainersChart from "./GainersChart";
import GainersThemeToggle from "./GainersThemeToggle";
import styles from "./GainersPage.module.css";
import {
  ASIAN_COUNTRIES,
  SESSION_LABEL,
  easternTime,
  fixed,
  levelsLine,
  marketCap,
  monthShort,
  niceDay,
  niceDayWithYear,
  shares,
  signalCandleTime,
  weekdayName,
  type GainersPageData,
} from "@/lib/chatGainersPages";
import { CHAT_THEME_KEY } from "@/lib/chatTheme";

const head = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--gd-head", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--gd-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--gd-mono", display: "swap" });

// #343: runs before the page paints, so a saved theme never flashes the device's one. Nothing saved leaves the
// attribute off, and the CSS follows the device. GainersThemeToggle keeps it right after that.
const themeScript = `try{var s=localStorage.getItem(${JSON.stringify(CHAT_THEME_KEY)});var t=s==="light"?"light":s==="dark"||s==="blade-runner"?"dark":"";if(t)document.currentScript.parentElement.setAttribute("data-gainers-theme",t)}catch(e){}`;

const CountryTag = ({ country }: { country: string }) => (
  <span className={ASIAN_COUNTRIES.has(country) ? `${styles.country} ${styles.asia}` : styles.country}>{country}</span>
);

/** #340: the approved gainers chart board, drawn from one day's stored data. */
export default function GainersPage({ data }: { data: GainersPageData }) {
  const { day, top, rest, total } = data;
  const nice = niceDay(day),
    weekday = weekdayName(day);
  const unknown = [...top, ...rest].some((stock) => stock.country === "Unknown");
  return (
    <div className={`${styles.page} ${head.variable} ${body.variable} ${mono.variable}`} data-gainers-page={day} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <main className={styles.main}>
        <header>
          <div className={styles.top}>
            <p className={styles.back}>
              <Link href="/chat?room=lb-review">Back to LB Review</Link>
            </p>
            <GainersThemeToggle />
          </div>
          <h1>{`${weekday}'s top gainers, ${niceDayWithYear(day)}`}</h1>
          <p className={styles.lede}>
            The six biggest moves from the gainers channel, on 2-minute charts. A stock only counts once an alert shows
            at least 150,000 shares. After-hours alerts are left out. That leaves {top.length + rest.length} of the
            day&apos;s {total} stocks. Asian companies are marked in orange.
          </p>
          <div className={styles.key}>
            <span><i style={{ background: "var(--alert)" }} />Up arrow: first alert over 150K</span>
            <span><i style={{ background: "var(--sma)" }} />200 SMA</span>
            <span><i style={{ background: "var(--vwap)" }} />VWAP</span>
            <span><i style={{ background: "var(--fg)" }} />Monthly pivot</span>
            <span><i style={{ background: "var(--missed)" }} />Missed pivots (dashed)</span>
            <span><i style={{ background: "var(--shade)" }} />Pre-market and after hours</span>
            <span>Times are Eastern. Scroll to zoom, drag to pan.</span>
          </div>
        </header>
        <section className={styles.grid}>
          {top.map((stock) => (
            <article className={styles.card} key={stock.sym} data-gainers-chart-card={stock.sym}>
              <header>
                <h2>{stock.sym}</h2>
                <b className={styles.up}>+{fixed(stock.peak, 0)}%</b>
                <CountryTag country={stock.country} />
                <span className={styles.count}>
                  {stock.alertCount} alert{stock.alertCount !== 1 ? "s" : ""}
                </span>
              </header>
              <p className={styles.meta}>
                First alert over 150K: <strong>{easternTime(stock.first.ts)}</strong> ET, {SESSION_LABEL[stock.first.sess]},
                at ${fixed(stock.first.px, 2)} on {shares(stock.first.vol)} shares. Market cap {marketCap(stock.lastCap)}.
              </p>
              <p className={`${styles.meta} ${styles.levels}`}>{levelsLine(stock, day)}</p>
              <GainersChart
                className={styles.chart}
                label={`2-minute candlestick chart of ${stock.sym}, ${nice}`}
                bars={stock.bars}
                sma={stock.sma}
                vwap={stock.vwap}
                signal={signalCandleTime(stock.first.ts)}
                pivot={stock.cmp}
                pivotTitle={`${monthShort(day)} pivot`}
                missed={stock.missed}
              />
            </article>
          ))}
        </section>
        <section>
          <h3>The other {rest.length} stocks over 150K</h3>
          <div className={styles.wrap}>
            <table>
              <thead>
                <tr>
                  <th>Stock</th><th>Country</th><th>Biggest alert</th><th>First alert over 150K</th><th>Session</th><th>Shares then</th><th>Market cap</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((stock) => (
                  <tr key={stock.sym}>
                    <td className={styles.symbol}>{stock.sym}</td>
                    <td><CountryTag country={stock.country} /></td>
                    <td className={styles.up}>+{fixed(stock.peak, 0)}%</td>
                    <td>{easternTime(stock.first.ts)}</td>
                    <td>{SESSION_LABEL[stock.first.sess]}</td>
                    <td>{shares(stock.first.vol)}</td>
                    <td>{marketCap(stock.lastCap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className={styles.note}>
          Research for reviewing the day, not trade advice. Ranked by the biggest percent gain shown in any alert that
          day. Market cap and percent gain come from the alerts themselves. Charts use Polygon 2-minute bars, regular and
          extended hours. Countries come from DilutionTracker
          {unknown ? "; Unknown means the company has not been looked up yet" : ""}. The 200 SMA and VWAP use 2-minute
          extended-hours bars, and VWAP restarts each day at 4 AM. Pivots are (high + low + close) / 3 of the month
          before, extended hours included, labeled by the month they applied to. A missed pivot is one price had not
          touched before {weekday}, so {weekday}&apos;s move may have reached it. Old prices are adjusted for reverse
          splits.
        </p>
      </main>
    </div>
  );
}
