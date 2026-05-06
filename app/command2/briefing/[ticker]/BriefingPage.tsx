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

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

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

function eyebrowFromCatalyst(headline: string, fallback: string): string {
  const trimmed = headline.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77).trimEnd()}...` : trimmed;
}

function PlaybookSide({
  num,
  title,
  side,
}: {
  num: string;
  title: string;
  side: BriefingTradingSide;
}) {
  return (
    <div className="pb-card">
      <div className="pb-head">
        <span className="pb-num">{num}</span>
        <span className="pb-title">{title}</span>
      </div>
      <div className="pb-strip">
        <div className="cell trigger">
          <div className="lbl">TRIGGER</div>
          <div className="val">{side.trigger}</div>
        </div>
        <div className="cell">
          <div className="lbl">STOP</div>
          <div className="val">{formatPrice(side.stop)}</div>
        </div>
        <div className="cell">
          <div className="lbl">TARGET</div>
          <div className="val">{formatPrice(side.target)}</div>
        </div>
      </div>
      <p className="pb-note">{side.note}</p>
    </div>
  );
}

function SectionHead({ label, num }: { label: string; num: string }) {
  return (
    <div className="section-head">
      <span className="lbl">{label}</span>
      <span className="num">{num}</span>
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

export default function BriefingPage({ briefing }: { briefing: StockBriefingRow }) {
  const p: BriefingPayload = briefing.payload;
  const { ticker } = briefing;
  const pa = p.price_action;
  const fin = p.financials;

  const isUp = pa.pct_change >= 0;
  const eyebrow = eyebrowFromCatalyst(p.catalyst.headline, "RESEARCH BRIEFING");
  const heroPhrase = firstSentence(p.bottom_line);
  const lede = p.bottom_line;

  const mktCapPrev = pa.prev_close * p.company.shares_out;
  const mktCapNow = pa.current_price * p.company.shares_out;
  const volRatio =
    pa.volume_prev > 0 ? pa.volume_today / pa.volume_prev : null;

  const showCatalyst = p.catalyst.bullets.length > 0;
  const reverseSplit = noteIncludes(p.company.structure_note, "reverse split");
  const dividendNote = noteIncludes(fin.notes, "dividend");

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="logo">L</span>
          <span>
            LONGBOARD<em>AI</em>
          </span>
        </div>
        <div className="stamp">
          <span className="live">BUDDY BRIEFING</span> ·{" "}
          {formatBriefingDate(briefing.briefing_date)}
        </div>
      </div>

      <section className="hero">
        <div className="eyebrow">{eyebrow}</div>
        <h1>
          <span className="ticker">{ticker}.</span>{" "}
          <span className="ed">{heroPhrase}</span>
        </h1>
        <p className="lede">{lede}</p>
      </section>

      <div className="stats">
        <div className="cell">
          <div className="lbl">TICKER</div>
          <div className="val">{ticker}</div>
          <div className="sub">{p.exchange}</div>
        </div>
        <div className="cell">
          <div className="lbl">PREV CLOSE</div>
          <div className="val">{formatPrice(pa.prev_close)}</div>
          <div className="sub">SETTLEMENT</div>
        </div>
        <div className="cell">
          <div className="lbl">{sessionLabel(pa.session)}</div>
          <div className={`val ${isUp ? "amb" : "dn"}`}>
            {formatPrice(pa.current_price)}
          </div>
          <div className="sub">{formatPctChange(pa.pct_change)}</div>
        </div>
        <div className="cell">
          <div className="lbl">SHARES OUT</div>
          <div className="val">{humanizeNumber(p.company.shares_out)}</div>
          <div className="sub">{p.company.sector.split("/")[0].trim()}</div>
        </div>
        <div className="cell">
          <div className="lbl">MKT CAP</div>
          <div className="val">{humanizeNumber(p.company.market_cap, { currency: true })}</div>
          <div className="sub">@ CURRENT</div>
        </div>
      </div>

      <section className="section">
        <SectionHead label="THE COMPANY" num="01" />
        <div className="card">
          <Row k="DESCRIPTION" italic>{p.company.description}</Row>
          <Row k="SECTOR">{p.company.sector}</Row>
          <Row k="EMPLOYEES">{humanizeNumber(p.company.employees)}</Row>
          <Row k="STRUCTURE" italic>{p.company.structure_note}</Row>
        </div>
      </section>

      {showCatalyst && (
        <section className="section">
          <SectionHead label="THE CATALYST" num="02" />
          <div className="card">
            <div className="catalyst-headline">{p.catalyst.headline}</div>
            <ul className="bullets">
              {p.catalyst.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="section">
        <SectionHead label="THE TAPE · THE PRINT + THE GAP" num="03" />
        <div className="tape">
          <div className="col">
            <div className="lbl">90-DAY RANGE</div>
            <div className="val">
              {formatPrice(pa.range_90d_low)} – {formatPrice(pa.range_90d_high)}
            </div>
            <div className="desc">The band before the news.</div>
          </div>
          <div className="col">
            <div className="lbl">PRE-PRINT</div>
            <div className="val">{formatPrice(pa.prev_close)}</div>
            <div className="desc">Last close before today&rsquo;s move.</div>
          </div>
          <div className="col">
            <div className="lbl">THE PRINT</div>
            <div className="val">{fin.period}</div>
            <div className="desc">Reported {fin.reported_date}.</div>
          </div>
          <div className="col">
            <div className="lbl">THE GAP</div>
            <div className="val amb">{formatPctChange(pa.pct_change)}</div>
            <div className="desc">Move on the tape vs. prior close.</div>
          </div>
          <div className="col">
            <div className="lbl">NOW · {sessionLabel(pa.session)}</div>
            <div className="val">{formatPrice(pa.current_price)}</div>
            <div className="desc">Where it&rsquo;s trading right now.</div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead label="THE 1-DAY MATH" num="04" />
        <p className="math-prose">
          Pre-print, <span className="num">{ticker}</span> closed at{" "}
          <span className="num">{formatPrice(pa.prev_close)}</span>. Today, on the back of{" "}
          {fin.period} earnings reported {fin.reported_date}, the print is{" "}
          <span className={`num ${isUp ? "amb" : ""}`}>
            {formatPrice(pa.current_price)}
          </span>{" "}
          — a{" "}
          <span className={`num ${isUp ? "amb" : ""}`}>
            {formatPctChange(pa.pct_change)}
          </span>{" "}
          move. Volume is{" "}
          <span className="num">{formatVolume(pa.volume_today)}</span>
          {volRatio != null && (
            <>
              {" "}vs.{" "}
              <span className="num">{formatVolume(pa.volume_prev)}</span> in the prior
              session, a <span className="num">{volRatio.toFixed(1)}×</span> ratio
            </>
          )}
          .
        </p>
      </section>

      <section className="section">
        <SectionHead label="CAP & TAPE" num="05" />
        <div className="card">
          <Row k="SHARES OUTSTANDING">{humanizeNumber(p.company.shares_out)}</Row>
          <Row k="MARKET CAP @ PREV CLOSE">{humanizeNumber(mktCapPrev, { currency: true })}</Row>
          <Row k="MARKET CAP @ CURRENT" changed>
            {humanizeNumber(mktCapNow, { currency: true })}
          </Row>
          <Row k="PREV SESSION VOLUME">{formatVolume(pa.volume_prev)}</Row>
          <Row k="CURRENT SESSION VOLUME" changed>
            {formatVolume(pa.volume_today)}
          </Row>
          <Row k="90-DAY RANGE">
            {formatPrice(pa.range_90d_low)} – {formatPrice(pa.range_90d_high)}
          </Row>
          {reverseSplit && <Row k="REVERSE SPLIT" italic>Flagged in structure note.</Row>}
          <Row k="LISTING">{p.exchange}</Row>
        </div>
      </section>

      <section className="section">
        <SectionHead label={`THE PRINT · ${fin.period}`} num="06" />
        <div className="card">
          <Row k="REVENUE">{humanizeNumber(fin.revenue, { currency: true })}</Row>
          <Row k="REVENUE YOY">{formatPctChange(fin.revenue_yoy_pct)}</Row>
          <Row k="EPS">
            {fin.eps.toFixed(2)} <span className="mono"> vs prior </span>
            {fin.eps_prior.toFixed(2)}
          </Row>
          {fin.free_cash_flow != null && (
            <Row k="FREE CASH FLOW">
              {humanizeNumber(fin.free_cash_flow, { currency: true })}
            </Row>
          )}
          {fin.cash_on_hand != null && (
            <Row k="CASH ON HAND">
              {humanizeNumber(fin.cash_on_hand, { currency: true })}
            </Row>
          )}
          {dividendNote && fin.notes && (
            <Row k="DIVIDEND" italic>{fin.notes}</Row>
          )}
          {fin.going_concern && (
            <Row k="GOING CONCERN" italic>Flagged on the print.</Row>
          )}
          {fin.notes && !dividendNote && (
            <Row k="NOTES" italic>{fin.notes}</Row>
          )}
          <Row k="REPORTED">{fin.reported_date}</Row>
        </div>
      </section>

      <section className="section">
        <SectionHead label="WHY IT&rsquo;S MOVING" num="07" />
        <div className="why">
          <div className="why-card">
            <div className="head">FRESH CATALYST</div>
            <p className="body">
              {p.catalyst.headline ||
                "No fresh news on the wire — the move is driven by tape, not headlines."}
            </p>
          </div>
          <div className="why-card">
            <div className="head">{p.sentiment.source.toUpperCase()} SENTIMENT</div>
            <p className="body">
              {p.sentiment.summary} (
              {p.sentiment.post_count} posts, last {p.sentiment.lookback_days}d.)
            </p>
          </div>
          <div className="why-card">
            <div className="head">VOLUME ON THE TAPE</div>
            <p className="body">
              {formatVolume(pa.volume_today)} traded today vs.{" "}
              {formatVolume(pa.volume_prev)} prior
              {volRatio != null && ` — a ${volRatio.toFixed(1)}× ratio`}.{" "}
              {isUp ? "Tape green from the open." : "Tape red into the print."}
            </p>
          </div>
        </div>
      </section>

      {p.risks.length > 0 && (
        <section className="section">
          <SectionHead label="RISK STACK" num="08" />
          <div className="risks">
            {p.risks.map((r, i) => (
              <div className="risk" key={i}>
                <div className="num">{CIRCLED[i] ?? `${i + 1}.`}</div>
                <div className="body">
                  <div className="cat">{r.category}</div>
                  <p className="text">{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <SectionHead label="OPENING PLAYBOOK" num="09" />
        <div className="playbook">
          <PlaybookSide num="①" title="Long the Momo" side={p.trading_angle.long} />
          <PlaybookSide num="②" title="Short the Fade" side={p.trading_angle.short} />
          <div className="pb-card">
            <div className="pb-head">
              <span className="pb-num">③</span>
              <span className="pb-title">The Skip</span>
            </div>
            <p className="pb-skip">
              Chops between{" "}
              <span className="num">{formatPrice(p.trading_angle.long.stop)}</span> and{" "}
              <span className="num">{formatPrice(p.trading_angle.short.stop)}</span>{" "}
              with no commitment. Don&rsquo;t chase the green candle — wait for second-day
              structure. Re-engage on a clean break or breakdown.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead label="NOTES & SOURCES" num="10" />
        <blockquote className="pull">{p.bottom_line}</blockquote>
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
        <p className="disclaimer">
          POSTED {formatGeneratedAt(p.generated_at)} · RESEARCH BRIEF — NOT
          INVESTMENT ADVICE; LONGBOARD AI DOES NOT HOLD A POSITION.
        </p>
      </section>

      <div className="footer">
        LONGBOARD AI · BUDDY · RESEARCH · {ticker} · BRIEFING · 03/03
      </div>
    </>
  );
}
