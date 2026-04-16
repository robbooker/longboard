import "./daily.css";
import Link from "next/link";
import type { Metadata } from "next";
import {
  dailyExcerpt,
  leadIntro,
  listEssays,
  loadEssay,
  pickDailyLead,
  rankForRail,
} from "@/lib/essays";
import type { EssayFrontmatter } from "@/lib/essays";
import NewsletterForm from "@/components/learn/NewsletterForm";

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

/** Split an essay title on its `title_accent` tail so the italic-moss
 *  fragment can be wrapped in an <em>. Mirrors the same split used in
 *  EssayHero so the typographic identity carries across surfaces. */
function titleWithAccent(fm: EssayFrontmatter) {
  if (!fm.title_accent || !fm.title.endsWith(fm.title_accent)) return <>{fm.title}</>;
  const head = fm.title.slice(0, fm.title.length - fm.title_accent.length).trimEnd();
  return (
    <>
      {head} <em>{fm.title_accent}</em>
    </>
  );
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

  // Volume count is a publication convention — one volume per year.
  // Issue number for the Daily itself is days-since-launch. Launch
  // date is the Phase 3L ship date (today). Good enough for v1; the
  // exact cadence lands once the publishing rhythm is real.
  const dailyNo = 1;

  // Lead story: pick featured-or-latest, load the body so we can
  // extract the drop-cap intro. Null only if no essays exist yet.
  const leadFm = pickDailyLead(essays);
  const leadFile = leadFm ? await loadEssay(leadFm.slug) : null;
  const leadIntroParagraphs = leadFile ? leadIntro(leadFile.body, 2) : [];

  // Right-rail "Most read": apply the rank sort, then render what
  // exists — never pad to match the mockup's 5-row visual weight.
  const rail = rankForRail(essays);

  // "Latest essay" rail block is always the highest-issue essay,
  // independent of featured or rank. Same slug powers the bottom
  // pull-quote band.
  const latest = essays[0] ?? null;

  // Features grid: the next 3 essays after the lead, same rank order
  // as the rail. Slice to what exists — no padding.
  const features = rail.filter((e) => e.slug !== leadFm?.slug).slice(0, 3);

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

      {/* ── Lede grid: lead story + right rail ── */}
      <div className="wrap">
        <section className="lede-grid">
          {leadFm ? (
            <article>
              <div className="lead-section-label">Lead · Today</div>
              <h2 className="lead-headline">{titleWithAccent(leadFm)}</h2>
              <p className="lead-deck">{leadFm.dek}</p>
              <p className="byline">
                <strong>Rob Booker</strong> · Issue {pad3(leadFm.issue)} · {leadFm.read_minutes} min read
                {leadFm.audio_url && (
                  <>
                    {" · "}
                    <Link href={`/learn/${leadFm.slug}`}>tape attached</Link>
                  </>
                )}
              </p>
              {leadIntroParagraphs.length > 0 && (
                <div className="lead-body">
                  {leadIntroParagraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  <Link href={`/learn/${leadFm.slug}`} className="lead-cta">
                    Read the full piece →
                  </Link>
                </div>
              )}
            </article>
          ) : (
            <article>
              <p className="byline">No essays yet. Drop a .mdx file in content/essays/.</p>
            </article>
          )}

          <aside className="rail">
            {rail.length > 0 && (
              <div className="rail-block">
                <div className="rail-head">Most read this week</div>
                <ol className="rail-list">
                  {rail.map((fm, i) => (
                    <li key={fm.slug}>
                      <span className="rail-num">{pad3(i + 1).slice(1)}</span>
                      <div>
                        <Link href={`/learn/${fm.slug}`}>
                          <p className="rail-item-title">{fm.title}</p>
                        </Link>
                        <p className="rail-item-meta">
                          Issue {pad3(fm.issue)} · {fm.read_minutes} min
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {latest && (
              <div className="rail-block">
                <div className="rail-head">Latest essay</div>
                <p className="rail-pull">&ldquo;{dailyExcerpt(latest)}&rdquo;</p>
                <p className="rail-item-meta">
                  Issue {pad3(latest.issue)} ·{" "}
                  <Link href={`/learn/${latest.slug}`}>Read</Link>
                </p>
              </div>
            )}

            <div className="sponsor-card">
              <div className="sponsor-tag">— Powered by</div>
              <h3 className="sponsor-title">
                Trade<span className="gold">Zero</span>.
              </h3>
              <p className="sponsor-body">
                Locate the borrow. Hit the bid. Hotkeys, low cost, real shorts. The broker the desk actually uses.
              </p>
              <a href="/tradezero" className="sponsor-cta">Open an account →</a>
            </div>
          </aside>
        </section>

        {/* ── Three-col features ── */}
        {features.length > 0 && (
          <div className="three-col">
            {features.map((fm) => (
              <article key={fm.slug}>
                <div className="article-art art-essay-2" />
                <p className="article-tag">§ Essay · {fm.read_minutes} min</p>
                <h3 className="article-headline">
                  <Link href={`/learn/${fm.slug}`}>{fm.title}</Link>
                </h3>
                <p className="article-deck">{fm.dek}</p>
                <p className="article-byline">
                  Issue {pad3(fm.issue)} · {fm.issue_label}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* ── Pull-quote band ── */}
      {latest && (
        <section className="pull-band">
          <div className="label">§ From the latest essay</div>
          <div>
            <p className="quote">&ldquo;{dailyExcerpt(latest)}&rdquo;</p>
            <p className="attr">
              — Issue {pad3(latest.issue)} ·{" "}
              <Link href={`/learn/${latest.slug}`}>{latest.title}</Link>
            </p>
          </div>
        </section>
      )}

      {/* ── Newsletter ── */}
      <section className="newsletter">
        <h2>The <em>Longboard</em> daily, in your inbox.</h2>
        <p>
          One essay, one trade, one chart. Wednesday mornings. Free, slightly cranky, occasionally useful.
        </p>
        <NewsletterForm />
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
