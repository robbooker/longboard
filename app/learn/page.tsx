import "./daily.css";
import type { Metadata } from "next";
import { listEssays } from "@/lib/essays";

export const metadata: Metadata = {
  title: "Longboard Daily",
  description: "A daily for traders who would rather be right than fast. Essays, video, and the view from the floor.",
  openGraph: {
    title: "Longboard Daily",
    description: "A daily for traders who would rather be right than fast.",
    type: "website",
    url: "/learn",
  },
};

/** Pad an integer to three digits. Used for issue numbers in the
 *  masthead meta strip. */
function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Long-form weekday + date string for the masthead meta, in ET. The
 *  Daily is a publication with a voice, not a live dashboard — so
 *  "Wednesday, April 15, 2026" reads as the masthead expects rather
 *  than a 24/7 clock that demands intraday freshness. */
function masterheadDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export default async function DailyHomePage() {
  const essays = await listEssays();
  const latestIssue = essays[0]?.issue ?? 0;
  const issueCount = essays.length;

  // Volume count is a publication convention — one volume per year.
  // Issue number for the Daily itself is days-since-launch. Launch
  // date is the Phase 3L ship date (today). Good enough for v1; the
  // exact cadence lands once the publishing rhythm is real.
  const dailyNo = 1;

  return (
    <div className="daily-page">
      {/* ── Top ribbon ── TODO(3L.5): wire to Polygon snapshot, cached 60s. */}
      <div className="ribbon">
        <div className="ribbon-inner">
          <div>
            <span className="live">
              <span className="pulse" />
              On the tape now
            </span>
            {" "}· MARA halts at 22.40
          </div>
          <div className="ribbon-tickers">
            <span>SPY <em className="up">+0.42%</em></span>
            <span>QQQ <em className="up">+0.61%</em></span>
            <span>VIX <em className="dn">−2.10%</em></span>
            <span>MARA <em className="dn">−4.80%</em></span>
            <span>ARAI <em className="up">+12.4%</em></span>
          </div>
        </div>
      </div>

      {/* ── Masthead ── */}
      <header className="masthead">
        <div className="masthead-meta-l">
          <div>Vol. I · No. {pad3(dailyNo)}</div>
          <div>{masterheadDate()}</div>
        </div>
        <div className="masthead-meta-r">
          <div>Houston · ET</div>
          <div>Issue {pad3(latestIssue)} in print</div>
        </div>
        <h1 className="masthead-title">Long<em>board</em>.</h1>
        <p className="masthead-tag">A daily for traders who would rather be right than fast</p>
      </header>

      {/* ── Top nav ── placeholder hrefs where routes don't exist yet;
          wired as content lands in future phases (3N Watch, etc). */}
      <nav className="topnav">
        <div className="topnav-links">
          <a href="/learn" className="active">Today</a>
          <a href="#">Essays</a>
          <a href="#">Watch</a>
          <a href="#">Live</a>
          <a href="#">Setups</a>
          <a href="#">Mindset</a>
          <a href="#">Field guide</a>
          <a href="#">Archive</a>
        </div>
        <a href="#" className="topnav-cta">Subscribe</a>
      </nav>

      {/* ── Lede grid: lead story + right rail (C2) ── */}
      <div className="wrap">
        <section className="lede-grid">
          <article>
            <div className="lead-section-label">Lead · Today</div>
            <h2 className="lead-headline">
              Lead story lands in <em>Commit 2.</em>
            </h2>
            <p className="lead-deck">
              Featured essay (or latest) will render here with drop-cap intro, byline, lead art, and a "Read the full piece →" link to the detail page.
            </p>
            <p className="byline"><strong>{issueCount} essays in print</strong> · Daily rebuilt on every push</p>
          </article>
          <aside className="rail">
            <div className="rail-block">
              <div className="rail-head">Most read this week</div>
              <p className="rail-item-meta">Rail content lands in Commit 2.</p>
            </div>
          </aside>
        </section>

        {/* ── Three-col features (C3) ── */}
        <div className="three-col">
          <article>
            <div className="article-art art-essay-2" />
            <p className="article-tag">§ Placeholder</p>
            <h3 className="article-headline">Features grid lands in Commit 3.</h3>
            <p className="article-deck">Three feature cards — essays after the lead, sorted by daily_rank — will render here.</p>
          </article>
          <article>
            <div className="article-art art-essay-2" />
            <p className="article-tag">§ Placeholder</p>
            <h3 className="article-headline">Each card will link to /learn/[slug].</h3>
            <p className="article-deck">Tag, headline, deck from frontmatter, byline from the issue meta.</p>
          </article>
          <article>
            <div className="article-art art-essay-2" />
            <p className="article-tag">§ Placeholder</p>
            <h3 className="article-headline">Audio badges + read-time carry through.</h3>
            <p className="article-deck">Consistent with the rail and the detail pages.</p>
          </article>
        </div>
      </div>

      {/* ── Pull-quote band (C3) ── */}
      <section className="pull-band">
        <div className="label">§ From the latest essay</div>
        <div>
          <p className="quote">
            Pull-quote band lands in Commit 3 — daily_excerpt from the latest essay will render here.
          </p>
          <p className="attr">— Issue {pad3(latestIssue)}</p>
        </div>
      </section>

      {/* ── Newsletter (C3) ── */}
      <section className="newsletter">
        <h2>The <em>Longboard</em> daily, in your inbox.</h2>
        <p>
          One essay, one trade, one chart. Wednesday mornings. Free, slightly cranky, occasionally useful.
        </p>
        <form>
          <input type="email" placeholder="you@yourbrokerage.com" disabled />
          <button type="submit" disabled>Subscribe →</button>
        </form>
        <p className="newsletter-status">Form wires up in Commit 3.</p>
      </section>

      {/* ── Footer ── */}
      <footer className="foot">
        <div className="foot-inner">
          <div className="signoff">
            <strong>Longboard.</strong>
            Made for traders who would rather be right than fast. A daily essay, a daily trade, a daily reason to size down.
          </div>
          <div>
            <h4>Read</h4>
            <ul>
              <li><a href="#">All essays</a></li>
              <li><a href="#">Field guide</a></li>
              <li><a href="#">Archive</a></li>
            </ul>
          </div>
          <div>
            <h4>Watch</h4>
            <ul>
              <li><a href="#">Open with Rob</a></li>
              <li><a href="#">The Playbook</a></li>
              <li><a href="#">Floor Tapes</a></li>
            </ul>
          </div>
          <div>
            <h4>House</h4>
            <ul>
              <li><a href="#">About</a></li>
              <li><a href="#">Sponsor</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <div>© {new Date().getFullYear()} Longboard.ai</div>
          <div>Set in Fraunces &amp; Source Serif 4</div>
        </div>
      </footer>
    </div>
  );
}
