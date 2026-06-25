import "./watch.css";
import Link from "next/link";
import type { Metadata } from "next";
import WatchNav from "./WatchNav";

export const metadata: Metadata = {
  title: "Longboard Watch",
  description: "Video for traders who would rather be right than fast.",
};

export default function WatchPage() {
  return (
    <div className="watch-page">
      {/* ── Nav ── */}
      <WatchNav>
        <div className="brand">LONGBOARD<span className="dot">.</span>AI</div>
        <div className="nav-links">
          <Link href="/watch" className="active">Watch</Link>
          <Link href="/learn">Learn</Link>
          <a href="#">Workspace</a>
          <a href="#">Live</a>
          <a href="#">Settings</a>
        </div>
        <div className="nav-right">
          <div className="nav-search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <span>Search</span>
          </div>
          <div className="avatar">R</div>
        </div>
      </WatchNav>

      {/* ── Hero ── */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="live-pill"><span className="pulse" />LIVE</span>
            <span>Featured · Series 04</span>
          </div>
          <h1 className="hero-title">Anatomy of a <em>Parabolic</em> Short.</h1>
          <p className="hero-deck">A four-part teardown of a single MARA trade: the setup that called it, the entry that almost wasn&apos;t, the moment Rob nearly covered, and what the tape said an hour later.</p>
          <div className="hero-meta">
            <span>4 episodes</span>
            <span>1h 14m</span>
            <span>Released Apr 12</span>
            <span>With Rob Booker</span>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
              Play episode 1
            </button>
            <button className="btn btn-ghost">+ My list</button>
            <button className="btn btn-ghost">Read the essay &rarr;</button>
          </div>
        </div>
      </section>

      {/* ── Shelves ── */}
      <main className="shelves">

        {/* continue watching */}
        <div className="shelf">
          <div className="shelf-head">
            <div className="shelf-title-group">
              <span className="shelf-roman">I.</span>
              <h2 className="shelf-title">Continue watching</h2>
              <span className="shelf-sub">&mdash; where you left off</span>
            </div>
            <a href="#" className="shelf-more">See all &rarr;</a>
          </div>
          <div className="row">
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mara" />
                <div className="card-thumb-overlay"><span className="duration">12:04</span></div>
                <div className="progress"><span style={{ width: "72%" }} /></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Trade Review</span>
                <h3 className="card-title">MARA short, Wednesday open</h3>
                <div className="card-meta">Rob Booker · 17 min · 72% watched</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-arai" />
                <div className="card-thumb-overlay"><span className="duration">08:12</span></div>
                <div className="progress"><span style={{ width: "34%" }} /></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Setup of the Day</span>
                <h3 className="card-title">ARAI: float, halt, reclaim</h3>
                <div className="card-meta">Rob Booker · 22 min · 34% watched</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-risk" />
                <div className="card-thumb-overlay"><span className="duration">06:48</span></div>
                <div className="progress"><span style={{ width: "88%" }} /></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Risk</span>
                <h3 className="card-title">When you&apos;re already down 2R by 9:42</h3>
                <div className="card-meta">Rob Booker · 9 min · 88% watched</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mind" />
                <div className="card-thumb-overlay"><span className="duration">19:30</span></div>
                <div className="progress"><span style={{ width: "12%" }} /></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Mindset</span>
                <h3 className="card-title">The cost of being right and small</h3>
                <div className="card-meta">Rob + guest · 26 min · 12% watched</div>
              </div>
            </div>
          </div>
        </div>

        {/* featured series */}
        <div className="shelf">
          <div className="shelf-head">
            <div className="shelf-title-group">
              <span className="shelf-roman">II.</span>
              <h2 className="shelf-title">Featured series</h2>
              <span className="shelf-sub">&mdash; editor&apos;s picks this week</span>
            </div>
            <a href="#" className="shelf-more">All series &rarr;</a>
          </div>
          <div className="row">
            <div className="card feature-card">
              <div className="card-thumb">
                <div className="card-thumb-art art-essay" />
                <div className="card-thumb-overlay"><span className="duration">4 ep</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">§ Series · New</span>
                <h3 className="card-title">The basic trade is against yourself.</h3>
                <p className="card-deck">A video adaptation of Issue 001. Four episodes, each pinned to a maxim from the essay. Watch the whole thing or pull one chapter when you need it.</p>
                <div className="card-meta">Rob Booker · 4 episodes · 58 min total</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-risk" />
                <div className="card-thumb-overlay"><span className="duration">6 ep</span></div>
                <div className="new-flag">NEW</div>
              </div>
              <div className="card-body">
                <span className="card-tag">Series</span>
                <h3 className="card-title">Never let a small loss become a huge one</h3>
                <div className="card-meta">6 episodes · 1h 22m</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mind" />
                <div className="card-thumb-overlay"><span className="duration">5 ep</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Series</span>
                <h3 className="card-title">Trade smaller than your ego likes</h3>
                <div className="card-meta">5 episodes · 1h 04m</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-tape" />
                <div className="card-thumb-overlay"><span className="duration">3 ep</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Series</span>
                <h3 className="card-title">You can&apos;t trade in the past</h3>
                <div className="card-meta">3 episodes · 41 min</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Editorial strip ── */}
      <section className="editorial-strip">
        <div className="left">§ From the latest essay</div>
        <div>
          <p className="pull">&ldquo;Stories are nicer than facts. This is most of the problem. The setup is a fact. Whether you take it is a story you tell yourself about who you are this morning.&rdquo;</p>
          <p className="pull-attr">&mdash; Issue 001 · <Link href="/learn/the-basic-trade-is-against-yourself">The basic trade is against yourself</Link></p>
        </div>
      </section>

      {/* ── More shelves ── */}
      <main className="shelves" style={{ paddingTop: 0 }}>
        <div className="shelf">
          <div className="shelf-head">
            <div className="shelf-title-group">
              <span className="shelf-roman">III.</span>
              <h2 className="shelf-title">Live + scheduled</h2>
              <span className="shelf-sub">&mdash; happening now and next</span>
            </div>
            <a href="#" className="shelf-more">Schedule &rarr;</a>
          </div>
          <div className="row">
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-live" />
                <div className="card-thumb-overlay"><span className="duration">LIVE NOW</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag" style={{ color: "var(--w-danger)" }}>● Live</span>
                <h3 className="card-title">Open with Rob &mdash; Apr 15 morning tape</h3>
                <div className="card-meta">217 watching · started 9:24 ET</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-vix" />
                <div className="card-thumb-overlay"><span className="duration">Apr 16 · 8:30</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Scheduled</span>
                <h3 className="card-title">Pre-CPI: what I&apos;m watching</h3>
                <div className="card-meta">Tomorrow · 8:30 ET · 30 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mind" />
                <div className="card-thumb-overlay"><span className="duration">Fri · 4:15</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Office Hours</span>
                <h3 className="card-title">Friday Q&amp;A &mdash; bring your blowups</h3>
                <div className="card-meta">Friday · 4:15 ET · 60 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-tape" />
                <div className="card-thumb-overlay"><span className="duration">Sat · 11:00</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Workshop</span>
                <h3 className="card-title">Reading the tape, slowly</h3>
                <div className="card-meta">Saturday · 11 ET · 90 min</div>
              </div>
            </div>
          </div>
        </div>

        <div className="shelf">
          <div className="shelf-head">
            <div className="shelf-title-group">
              <span className="shelf-roman">IV.</span>
              <h2 className="shelf-title">Setups that actually paid</h2>
              <span className="shelf-sub">&mdash; with the trade journal attached</span>
            </div>
            <a href="#" className="shelf-more">Browse the journal &rarr;</a>
          </div>
          <div className="row">
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mara" />
                <div className="card-thumb-overlay"><span className="duration">14:22</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">+ 3.4R</span>
                <h3 className="card-title">MARA · gap-and-crap, Apr 8</h3>
                <div className="card-meta">Short @ 22.10 · cover @ 19.80 · 14 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-arai" />
                <div className="card-thumb-overlay"><span className="duration">11:08</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">+ 2.1R</span>
                <h3 className="card-title">ARAI · halt + reclaim, Apr 4</h3>
                <div className="card-meta">Long @ 4.10 · out @ 5.30 · 11 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-tape" />
                <div className="card-thumb-overlay"><span className="duration">07:50</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">+ 1.8R</span>
                <h3 className="card-title">SOXL · VWAP rejection, Apr 2</h3>
                <div className="card-meta">Short @ 31.40 · cover @ 30.55 · 8 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-risk" />
                <div className="card-thumb-overlay"><span className="duration">09:14</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag" style={{ color: "var(--w-danger)" }}>&minus; 1.0R</span>
                <h3 className="card-title">OPRA · the loss I should have taken faster</h3>
                <div className="card-meta">Long @ 14.20 · stopped 13.90 · 9 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-vix" />
                <div className="card-thumb-overlay"><span className="duration">06:30</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">+ 1.3R</span>
                <h3 className="card-title">VIX spike fade, Apr 1</h3>
                <div className="card-meta">Short VIX call · 7 min</div>
              </div>
            </div>
          </div>
        </div>

        <div className="shelf">
          <div className="shelf-head">
            <div className="shelf-title-group">
              <span className="shelf-roman">V.</span>
              <h2 className="shelf-title">Mindset &amp; risk</h2>
              <span className="shelf-sub">&mdash; the boring half that pays the bills</span>
            </div>
            <a href="#" className="shelf-more">All in this room &rarr;</a>
          </div>
          <div className="row">
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mind" />
                <div className="card-thumb-overlay"><span className="duration">22:18</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Talk</span>
                <h3 className="card-title">A conversation about quitting on green days</h3>
                <div className="card-meta">Rob + Mike Bellafiore · 22 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-risk" />
                <div className="card-thumb-overlay"><span className="duration">18:04</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Talk</span>
                <h3 className="card-title">Position sizing for people who lie to themselves</h3>
                <div className="card-meta">Rob solo · 18 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-essay" />
                <div className="card-thumb-overlay"><span className="duration">31:00</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Read-along</span>
                <h3 className="card-title">Reading Issue 003 out loud, with footnotes</h3>
                <div className="card-meta">Rob Booker · 31 min</div>
              </div>
            </div>
            <div className="card">
              <div className="card-thumb">
                <div className="card-thumb-art art-mind" />
                <div className="card-thumb-overlay"><span className="duration">14:12</span></div>
              </div>
              <div className="card-body">
                <span className="card-tag">Field guide</span>
                <h3 className="card-title">What it actually feels like at &minus; 4R</h3>
                <div className="card-meta">Rob solo · 14 min</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="wfoot">
        <div className="copy">&copy; 2026 Longboard.ai · <em>made for traders, slowly</em></div>
        <div>v 0.4.2 · paper / live</div>
      </footer>
    </div>
  );
}
