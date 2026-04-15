import Link from "next/link";
import type { Metadata } from "next";
import EssayMasthead from "@/components/essays/EssayMasthead";
import { listEssays, monthYear } from "@/lib/essays";
import type { EssayFrontmatter } from "@/lib/essays";

export const metadata: Metadata = {
  title: "Longboard Essays",
  description: "Long-form writing on process, restraint, and the psychology of trading.",
  // og:image auto-wired from sibling opengraph-image.tsx.
  openGraph: {
    title: "Longboard Essays",
    description: "Long-form writing on process, restraint, and the psychology of trading.",
    type: "website",
    url: "/learn",
  },
};

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function titleWithAccent(fm: EssayFrontmatter) {
  if (!fm.title_accent || !fm.title.endsWith(fm.title_accent)) return <>{fm.title}</>;
  const head = fm.title.slice(0, fm.title.length - fm.title_accent.length).trimEnd();
  return (
    <>
      {head} <span className="accent">{fm.title_accent}</span>
    </>
  );
}

export default async function LearnIndexPage() {
  const essays = await listEssays();
  const latestReadMinutes = essays[0]?.read_minutes ?? 0;
  const latestIssue = essays[0]?.issue ?? 1;
  const latestMonthYear = essays[0] ? monthYear(essays[0].published) : "";

  return (
    <>
      {/* Masthead uses the newest essay's meta so the top strip stays
          live with the current issue rather than showing a fixed header. */}
      <EssayMasthead issueNo={latestIssue} monthYear={latestMonthYear} readMinutes={latestReadMinutes} />

      <section className="hero">
        <div className="kicker">Long-form · Archive</div>
        <h1>
          Essays <span className="accent">on process.</span>
        </h1>
        <p className="dek">
          Long-form writing on the mechanics of trading. Restraint, size,
          the disposition effect, and the quietly destructive habit of
          asking a good trade to become a perfect one.
        </p>
      </section>

      <main className="content essay-index">
        <div className="marginalia-left" />
        <div>
          <ol className="essay-list">
            {essays.map((fm) => (
              <li key={fm.slug} className="essay-card">
                <Link href={`/learn/${fm.slug}`} className="essay-card-link">
                  <div className="essay-card-meta">
                    <span>No. {pad3(fm.issue)}</span>
                    <span>{monthYear(fm.published)}</span>
                    <span>Reading · {fm.read_minutes} min</span>
                    <span>Filed under <em>{fm.filed_under}</em></span>
                    {fm.audio_url && (
                      <span className="essay-card-audio-badge" aria-label="Audio available">
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ marginRight: 6 }}>
                          <path d="M2 1 L8 5 L2 9 Z" fill="currentColor" />
                        </svg>
                        Audio
                      </span>
                    )}
                  </div>
                  <div className="essay-card-kicker">{fm.kicker}</div>
                  <h2 className="essay-card-title">{titleWithAccent(fm)}</h2>
                  <p className="essay-card-dek">{fm.dek}</p>
                </Link>
              </li>
            ))}
            {essays.length === 0 && (
              <li className="essay-empty">No essays yet. Drop a <code>.mdx</code> file in <code>content/essays/</code>.</li>
            )}
          </ol>
        </div>
        <div className="marginalia-right" />
      </main>
    </>
  );
}
