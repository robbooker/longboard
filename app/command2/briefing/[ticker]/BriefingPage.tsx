import type { ReactNode } from "react";
import type {
  BriefingPayload,
  BriefingTradingSide,
  StockBriefingRow,
} from "@/lib/briefings/types";
import {
  formatBriefingDate,
  formatGeneratedAt,
  formatPctChange,
  formatPrice,
  formatVolume,
  humanizeNumber,
} from "@/lib/briefings/format";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";

const CIRCLED = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

function firstSentence(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/^[^.?!]+[.?!]/);
  return (m ? m[0] : s).trim();
}

function sessionLabel(session: string): string {
  switch (session) {
    case "premarket":
      return "PREMARKET";
    case "afterhours":
      return "AFTER HOURS";
    case "closed":
      return "CLOSED";
    default:
      return "REGULAR HOURS";
  }
}

function noteIncludes(notes: string | null | undefined, needle: string): boolean {
  if (!notes) return false;
  return notes.toLowerCase().includes(needle.toLowerCase());
}

function hasReverseSplitFlag(notes: string | null | undefined): boolean {
  if (!notes) return false;
  const n = notes.toLowerCase();
  if (!n.includes("reverse split")) return false;
  return !/(no|none|without|not)\s+(recent\s+)?reverse splits?/.test(n);
}

function structureSummary(notes: string): string {
  const n = notes.toLowerCase();
  const parts: string[] = [];

  if (n.includes("large-cap")) parts.push("large-cap");
  else if (n.includes("small-cap")) parts.push("small-cap");
  else if (n.includes("mid-cap")) parts.push("mid-cap");

  if (n.includes("liquid")) parts.push("liquid float");
  else if (n.includes("float")) parts.push("float noted");

  if (/(no|none|without|not)\s+(recent\s+)?reverse splits?/.test(n)) {
    parts.push("no recent R/S");
  }

  if (n.includes("dilution risk")) parts.push("dilution risk noted");

  return parts.length > 0 ? parts.join(" · ") : truncateText(notes, 58);
}

function eyebrowFromCatalyst(headline: string, fallback: string): string {
  const trimmed = headline.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.length > 68 ? `${trimmed.slice(0, 65).trimEnd()}...` : trimmed;
}

function truncateText(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}...`;
}

function heroHeadline(text: string, ticker: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const withoutTicker = cleaned.replace(
    new RegExp(`^${ticker.replace(".", "\\.")}[\\s.:,-]+`, "i"),
    "",
  );
  const headline = withoutTicker || cleaned;
  const beforeDash = headline.split(/\s+[—-]\s+/)[0]?.trim();
  if (beforeDash && beforeDash.length >= 28 && beforeDash.length <= 88) {
    return beforeDash;
  }
  const beforeComma = headline.split(",")[0]?.trim();
  if (beforeComma && beforeComma.length >= 28) return truncateText(beforeComma, 82);
  return truncateText(headline, 82);
}

function fallbackEditorialHeadline(p: BriefingPayload): string {
  const haystack = [
    p.catalyst.headline,
    ...p.catalyst.bullets,
    p.bottom_line,
    p.company.structure_note,
    p.financials.notes ?? "",
    ...p.risks.map((r) => `${r.category} ${r.text}`),
  ]
    .join(" ")
    .toLowerCase();
  const pct = p.price_action.pct_change;
  const bigMove = Math.abs(pct) >= 10;
  const hasNoReverseSplit = /(no|none|without|not)\s+(recent\s+)?reverse splits?/.test(haystack);

  if (
    /(pdufa|afrezza|fda|label)/.test(haystack) &&
    /(front.?run|ahead|before|after market|binary|event)/.test(haystack)
  ) {
    return "The Tape Front-Runs the News";
  }
  if (/(pdufa|afrezza|fda|label)/.test(haystack)) {
    return "PDUFA Party, Fine Print Included";
  }
  if (/(nvidia|meta|springboard|fiber|optical)/.test(haystack)) {
    return "The Springboard Has a Rocket";
  }
  if (/(upgrade|analyst|price target)/.test(haystack)) {
    return "Analysts Found the Launch Button";
  }
  if (/(offering|dilution|shelf|atm|warrant)/.test(haystack) && bigMove) {
    return "The Rocket Has Fine Print";
  }
  if (haystack.includes("reverse split") && !hasNoReverseSplit) {
    return "Split Math, Same Circus";
  }
  if (/(earnings|eps|revenue|guidance)/.test(haystack) && /(beat|beats|raise|raised|hike|profit)/.test(haystack)) {
    return "The Beat Has Legs";
  }
  if (/(earnings|eps|revenue|guidance)/.test(haystack)) {
    return bigMove ? "Earnings Lit the Fuse" : "Earnings Brought the Receipts";
  }
  if (/(volume|tape)/.test(haystack) && /(no fresh|unclear|no clear|no obvious)/.test(haystack)) {
    return "All Tape, No Alibi";
  }
  if (pct >= 15) return "The Tape Got Loud";
  if (pct <= -10) return "The Floor Asked Questions";
  return "The Tape Has Opinions";
}

function shortExchange(exchange: string): string {
  return exchange.replace(/\s+/g, " ").trim() || "LISTED";
}

function pctClass(n: number): string {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

function formatNullableNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "not provided";
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: "up" | "down" | "amber";
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` ${tone}` : ""}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function SectionHead({ label, num }: { label: string; num: string }) {
  return (
    <div className="section-head">
      <span>{label}</span>
      <span>{num}</span>
    </div>
  );
}

function Row({
  k,
  children,
  changed,
  italic,
}: {
  k: string;
  children: ReactNode;
  changed?: boolean;
  italic?: boolean;
}) {
  return (
    <div className={`row${changed ? " changed" : ""}`}>
      <div className="k">{k}</div>
      <div className={`v${italic ? " ed-row" : ""}`}>{children}</div>
    </div>
  );
}

function ListCard({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="list-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function ReportHeader({
  ticker,
  date,
  right,
}: {
  ticker: string;
  date: string;
  right?: string;
}) {
  return (
    <header className="report-header">
      <div className="brand">
        <span className="logo">L</span>
        <span className="brand-name">
          LONGBOARD <em>AI</em>
        </span>
      </div>
      <div className="stamp">
        <span>BUDDY BRIEFING</span>
        <span>{ticker}</span>
        <span>{right ?? date}</span>
      </div>
    </header>
  );
}

function MiniTape({ isUp }: { isUp: boolean }) {
  const stroke = isUp ? "#f5a524" : "#a91e2c";
  const fill = isUp ? "#f5a524" : "#a91e2c";

  return (
    <svg
      className="mini-tape"
      viewBox="0 0 360 100"
      role="img"
      aria-label="Stylized 90-day tape"
    >
      <defs>
        <linearGradient id="briefingTapeFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.42" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="tape-grid" d="M8 22H352 M8 54H352 M8 84H352" />
      <path
        className="tape-area"
        d="M10 78 L40 72 L66 80 L96 64 L126 56 L156 62 L188 48 L220 56 L250 42 L280 46 L310 34 L350 28 L350 96 L10 96 Z"
        fill="url(#briefingTapeFill)"
      />
      <path
        className="tape-line"
        d="M10 78 L40 72 L66 80 L96 64 L126 56 L156 62 L188 48 L220 56 L250 42 L280 46 L310 34 L350 28"
        stroke={stroke}
      />
      <path className="tape-marker" d="M314 16V88" />
      <circle cx="314" cy="34" r="4" fill={stroke} />
    </svg>
  );
}

function PlaybookSide({
  num,
  label,
  title,
  side,
  tone,
}: {
  num: string;
  label: string;
  title: string;
  side: BriefingTradingSide;
  tone: "long" | "short";
}) {
  return (
    <article className="pb-card">
      <div className="pb-top">
        <h3>
          <span className="pb-num">{num}</span> {title}
        </h3>
        <span className={`side-tag ${tone}`}>{label}</span>
      </div>
      <p className="pb-note">{side.note}</p>
      <div className="pb-strip">
        <div>
          <span>TRIGGER</span>
          <strong>{side.trigger}</strong>
        </div>
        <div>
          <span>STOP</span>
          <strong>{formatPrice(side.stop)}</strong>
        </div>
        <div>
          <span>TARGET</span>
          <strong>{formatPrice(side.target)}</strong>
        </div>
      </div>
    </article>
  );
}

export default function BriefingPage({ briefing }: { briefing: StockBriefingRow }) {
  const p: BriefingPayload = briefing.payload;
  const { ticker } = briefing;
  const pa = p.price_action;
  const fin = p.financials;

  const isUp = pa.pct_change >= 0;
  const tone = pctClass(pa.pct_change);
  const eyebrow = eyebrowFromCatalyst(p.catalyst.headline, "RESEARCH BRIEFING");
  const heroPhrase = heroHeadline(
    p.editorial_headline || fallbackEditorialHeadline(p),
    ticker,
  );
  const mktCapPrev = pa.prev_close * p.company.shares_out;
  const mktCapNow = pa.current_price * p.company.shares_out;
  const volRatio = pa.volume_prev > 0 ? pa.volume_today / pa.volume_prev : null;
  const reverseSplit = hasReverseSplitFlag(p.company.structure_note);
  const dividendNote = noteIncludes(fin.notes, "dividend");
  const briefingDate = formatBriefingDate(briefing.briefing_date);
  const session = sessionLabel(pa.session);
  const rangeText = `${formatPrice(pa.range_90d_low)} - ${formatPrice(
    pa.range_90d_high,
  )}`;
  const skipLow = Math.min(p.trading_angle.long.stop, p.trading_angle.short.stop);
  const skipHigh = Math.max(
    p.trading_angle.long.stop,
    p.trading_angle.short.stop,
  );

  return (
    <main className="report-shell">
      <section className="report-page summary-page">
        <ReportHeader
          ticker={ticker}
          date={briefingDate}
          right={formatGeneratedAt(p.generated_at)}
        />

        <div className="hero-grid">
          <div>
            <div className="eyebrow">
              <span /> {eyebrow}
            </div>
            <h1>
              {ticker}. <em>{heroPhrase}</em>
            </h1>
          </div>
          <p className="lede">{p.bottom_line}</p>
        </div>

        <div className="stats-bar">
          <Stat
            label="Ticker"
            value={ticker}
            sub={`${shortExchange(p.exchange)} · ${p.company.sector}`}
            tone="amber"
          />
          <Stat label="Prev Close" value={formatPrice(pa.prev_close)} sub="Last full print" />
          <Stat
            label={session}
            value={formatPrice(pa.current_price)}
            sub={formatPctChange(pa.pct_change)}
            tone={tone === "down" ? "down" : "up"}
          />
          <Stat
            label="Shares Out"
            value={humanizeNumber(p.company.shares_out)}
            sub={structureSummary(p.company.structure_note)}
            tone="amber"
          />
          <Stat
            label="Mkt Cap"
            value={humanizeNumber(p.company.market_cap, { currency: true })}
            sub="At current"
          />
        </div>

        <p className="summary-prose">
          {fin.period} print: revenue{" "}
          <strong>{humanizeNumber(fin.revenue, { currency: true })}</strong> (
          <strong>{formatPctChange(fin.revenue_yoy_pct)} YoY</strong>), EPS{" "}
          <strong>{formatNullableNumber(fin.eps)}</strong> vs. prior{" "}
          <strong>{formatNullableNumber(fin.eps_prior)}</strong>. Volume is{" "}
          <strong>{formatVolume(pa.volume_today)}</strong> vs.{" "}
          {formatVolume(pa.volume_prev)} prior session
          {volRatio != null && (
            <>
              {" "}
              (<strong>{volRatio.toFixed(1)}x</strong>)
            </>
          )}
          .
        </p>

        <div className="tape-panel">
          <div>
            <div className="panel-label">{session} · PRICE ACTION</div>
            <div className="panel-price">
              {formatPrice(pa.current_price)}{" "}
              <span className={tone}>{formatPctChange(pa.pct_change)}</span>
            </div>
            <div className="panel-sub">
              90-day range {rangeText} · current volume{" "}
              {formatVolume(pa.volume_today)}
            </div>
          </div>
          <MiniTape isUp={isUp} />
        </div>

        <section className="briefing-chart-panel" aria-label={`${ticker} price chart`}>
          <Command2EmbeddedStockChart ticker={ticker} rankLabel="DETAIL" />
        </section>

        <div className="two-col intro-grid">
          <div>
            <SectionHead label="THE COMPANY" num="01" />
            <ListCard title={`${p.company_name} (${shortExchange(p.exchange)})`}>
              <Bullets
                items={[
                  p.company.description,
                  p.company.sector,
                  `${humanizeNumber(p.company.employees)} employees`,
                  `${humanizeNumber(p.company.shares_out)} shares out · ${
                    p.company.structure_note
                  }`,
                ]}
              />
            </ListCard>
          </div>
          <div>
            <SectionHead label="THE CATALYST" num="02" />
            <ListCard title={p.catalyst.headline || "Tape-driven move"}>
              <Bullets
                items={
                  p.catalyst.bullets.length > 0
                    ? p.catalyst.bullets
                    : [p.bottom_line]
                }
              />
            </ListCard>
          </div>
        </div>

        <div className="timeline-wrap">
          <SectionHead label="THE TAPE · THE PRINT + THE GAP" num="03" />
          <div className="timeline">
            <div className="step">
              <i />
              <span>90-DAY RANGE</span>
              <strong>{rangeText}</strong>
              <small>pre-move band</small>
            </div>
            <div className="step">
              <i />
              <span>PRE-PRINT</span>
              <strong>{formatPrice(pa.prev_close)}</strong>
              <small>last close</small>
            </div>
            <div className="step">
              <i />
              <span>{fin.period}</span>
              <strong>{fin.reported_date}</strong>
              <small>fresh print</small>
            </div>
            <div className="step active">
              <i />
              <span>{session}</span>
              <strong>{formatPrice(pa.current_price)}</strong>
              <small>{formatPctChange(pa.pct_change)}</small>
            </div>
            <div className="step">
              <i />
              <span>TRADE ZONE</span>
              <strong>
                {formatPrice(p.trading_angle.long.stop)} /{" "}
                {formatPrice(p.trading_angle.long.target)}
              </strong>
              <small>levels matter</small>
            </div>
          </div>
        </div>

        <footer className="page-foot">
          <span>LONGBOARD AI · BUDDY · RESEARCH</span>
          <span>{ticker} · SUMMARY · 01 / 03</span>
        </footer>
      </section>

      <section className="report-page math-page">
        <ReportHeader ticker={ticker} date={briefingDate} />
        <div className="split-hero">
          <div>
            <div className="eyebrow">
              <span /> {formatPctChange(pa.pct_change)} · {session} ·{" "}
              {fin.period}
            </div>
            <h2>
              The setup is <em>{isUp ? "moving" : "under pressure"}</em>.
            </h2>
          </div>
          <p>
            Current print sits at <strong>{formatPrice(pa.current_price)}</strong>{" "}
            against a 90-day band of <strong>{rangeText}</strong>. The trade is
            about level confirmation, not admiration.
          </p>
        </div>

        <SectionHead label="THE 1-DAY MATH" num="04" />
        <div className="math-block">
          <div className={`donut ${tone}`}>
            <span>{formatPctChange(pa.pct_change)}</span>
            <small>{session}</small>
          </div>
          <div className="math-lines">
            <div>
              <b>Pre-print close</b>
              <span>{formatPrice(pa.prev_close)}</span>
            </div>
            <p>
              Setup before the print. {ticker} then moved to{" "}
              <strong>{formatPrice(pa.current_price)}</strong> on{" "}
              {formatVolume(pa.volume_today)} volume.
            </p>
            <div>
              <b>{fin.period}</b>
              <span>
                {humanizeNumber(fin.revenue, { currency: true })} revenue ·{" "}
                {formatPctChange(fin.revenue_yoy_pct)}
              </span>
            </div>
            <p>
              EPS printed <strong>{formatNullableNumber(fin.eps)}</strong> vs.{" "}
              <strong>{formatNullableNumber(fin.eps_prior)}</strong> prior.
              {fin.free_cash_flow != null && (
                <>
                  {" "}
                  Free cash flow:{" "}
                  <strong>
                    {humanizeNumber(fin.free_cash_flow, { currency: true })}
                  </strong>
                  .
                </>
              )}
            </p>
          </div>
        </div>

        <div className="two-col tables-grid">
          <div>
            <SectionHead label="CAP & TAPE" num="05" />
            <div className="table-card">
              <Row k="Shares outstanding">{humanizeNumber(p.company.shares_out)}</Row>
              <Row k="Market cap @ close">
                {humanizeNumber(mktCapPrev, { currency: true })}
              </Row>
              <Row k="Market cap @ current" changed>
                {humanizeNumber(mktCapNow, { currency: true })}
              </Row>
              <Row k="Prev session vol">{formatVolume(pa.volume_prev)}</Row>
              <Row k="Current session vol" changed>
                {formatVolume(pa.volume_today)}
              </Row>
              <Row k="90-day range">{rangeText}</Row>
              {reverseSplit && (
                <Row k="Reverse split" italic>
                  Flagged in structure note.
                </Row>
              )}
              <Row k="Listing">{shortExchange(p.exchange)}</Row>
            </div>
          </div>
          <div>
            <SectionHead label={`THE PRINT · ${fin.period}`} num="06" />
            <div className="table-card">
              <Row k="Revenue">
                {humanizeNumber(fin.revenue, { currency: true })}
              </Row>
              <Row k="Revenue YoY">{formatPctChange(fin.revenue_yoy_pct)}</Row>
              <Row k="EPS">
                {formatNullableNumber(fin.eps)}{" "}
                <span className="mono">vs prior</span>{" "}
                {formatNullableNumber(fin.eps_prior)}
              </Row>
              {fin.free_cash_flow != null && (
                <Row k="Free cash flow">
                  {humanizeNumber(fin.free_cash_flow, { currency: true })}
                </Row>
              )}
              {fin.cash_on_hand != null && (
                <Row k="Cash on hand">
                  {humanizeNumber(fin.cash_on_hand, { currency: true })}
                </Row>
              )}
              {dividendNote && fin.notes && (
                <Row k="Dividend" italic>
                  {fin.notes}
                </Row>
              )}
              {fin.going_concern && (
                <Row k="Going concern" italic>
                  Flagged on the print.
                </Row>
              )}
              {fin.notes && !dividendNote && (
                <Row k="Notes" italic>
                  {fin.notes}
                </Row>
              )}
              <Row k="Reported">{fin.reported_date}</Row>
            </div>
          </div>
        </div>

        <div className="callout-band">
          <div>{formatPrice(pa.range_90d_high)}</div>
          <p>
            90-day high is <strong>{formatPrice(pa.range_90d_high)}</strong>.
            Above it with volume holding, target continuation. Below{" "}
            <strong>{formatPrice(p.trading_angle.long.stop)}</strong>, respect
            the fade.
          </p>
        </div>

        <SectionHead label="WHY IT'S MOVING" num="07" />
        <div className="why-grid">
          <ListCard title="Fresh catalyst">
            <Bullets
              items={[
                p.catalyst.headline || "No fresh headline; tape is driving the move.",
              ]}
            />
          </ListCard>
          <ListCard title={`${p.sentiment.source} sentiment`}>
            <Bullets
              items={[
                `${p.sentiment.summary} · ${p.sentiment.post_count} posts over ${p.sentiment.lookback_days}d.`,
              ]}
            />
          </ListCard>
          <ListCard title="Volume on the tape">
            <Bullets
              items={[
                `${formatVolume(pa.volume_today)} traded today vs. ${formatVolume(
                  pa.volume_prev,
                )} prior${
                  volRatio != null ? ` · ${volRatio.toFixed(1)}x ratio` : ""
                }.`,
              ]}
            />
          </ListCard>
        </div>

        <footer className="page-foot">
          <span>LONGBOARD AI · BUDDY · RESEARCH</span>
          <span>{ticker} · THE MATH · 02 / 03</span>
        </footer>
      </section>

      <section className="report-page framework-page">
        <ReportHeader ticker={ticker} date={briefingDate} />
        <div className="split-hero framework-hero">
          <div>
            <div className="eyebrow">
              <span /> RISK STACK · TRADE FRAMEWORK · OPENING PLAN
            </div>
            <h2>
              Two numbers: <em>{formatPrice(p.trading_angle.long.target)}</em>{" "}
              and {formatPrice(p.trading_angle.long.stop)}.
            </h2>
          </div>
          <p>
            Long the confirmation, short the failure, skip the chop. The brief is
            useful only if it keeps the trade smaller than the story.
          </p>
        </div>

        <div className="two-col framework-grid">
          <div>
            <SectionHead label="RISK STACK" num="08" />
            <div className="risks">
              {p.risks.map((r, i) => (
                <article className="risk" key={i}>
                  <div className="risk-num">{CIRCLED[i] ?? `${i + 1}`}</div>
                  <div>
                    <h3>{r.category}</h3>
                    <p>{r.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <SectionHead label="OPENING PLAYBOOK" num="09" />
            <div className="playbook">
              <PlaybookSide
                num="1"
                label="LONG"
                title="Long the Momo"
                side={p.trading_angle.long}
                tone="long"
              />
              <PlaybookSide
                num="2"
                label="SHORT"
                title="Short the Fade"
                side={p.trading_angle.short}
                tone="short"
              />
              <article className="pb-card skip">
                <div className="pb-top">
                  <h3>
                    <span className="pb-num">3</span> The Skip
                  </h3>
                  <span className="side-tag pass">PASS</span>
                </div>
                <p className="pb-note">
                  Chops between{" "}
                  <strong>
                    {formatPrice(skipLow)}-{formatPrice(skipHigh)}
                  </strong>{" "}
                  with no commitment. Watch only until the range resolves.
                </p>
                <div className="pb-strip">
                  <div>
                    <span>SIGNAL</span>
                    <strong>Chop</strong>
                  </div>
                  <div>
                    <span>RANGE</span>
                    <strong>
                      {formatPrice(skipLow)}-{formatPrice(skipHigh)}
                    </strong>
                  </div>
                  <div>
                    <span>ACTION</span>
                    <strong>Watch only</strong>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>

        <div className="bottom-line">
          <div>
            {isUp
              ? `Hold ${formatPrice(p.trading_angle.long.stop)} or fade.`
              : `Recover ${formatPrice(p.trading_angle.short.stop)} or fade.`}
          </div>
          <p>{p.bottom_line}</p>
        </div>

        <SectionHead label="NOTES & SOURCES" num="10" />
        <div className="sources-block">
          <p>
            <strong>{heroPhrase}</strong> Posted {formatGeneratedAt(p.generated_at)}.
            Research brief only; not investment advice.
          </p>
          {p.sources.length > 0 && (
            <ul className="sources">
              {p.sources.map((s, i) => (
                <li key={i}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.label}
                    </a>
                  ) : (
                    s.label
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="page-foot">
          <span>LONGBOARD AI · BUDDY · RESEARCH</span>
          <span>{ticker} · FRAMEWORK · 03 / 03</span>
        </footer>
      </section>
    </main>
  );
}
