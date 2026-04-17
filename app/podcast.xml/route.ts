import { listEssays } from "@/lib/essays";
import type { EssayFrontmatter } from "@/lib/essays";

const SITE = "https://longboard-ruddy.vercel.app";
const FEED_URL = `${SITE}/podcast.xml`;
const COVER_URL = "https://audio.longboardai.com/cover.png";

const SHORT_DESC =
  "Short essays on trading from Rob Booker. The basic trade is against yourself. Never let a small loss become a huge one. And other things you already knew.";

const LONG_DESC = `Rob Booker has been trading for twenty-five years. These are short essays — usually under fifteen minutes — on the things that actually matter once you've been doing it long enough to have been wrong about most of the things you used to be sure of.

The basic trade is against yourself. Never let a small loss become a huge one. Trade smaller than your ego would like. You can't trade in the past. Each episode takes one idea seriously, looks at why it's obvious, and then looks at why nobody does it anyway.

The essays are also published in written form at longboardai.com/learn. Some people prefer to read. Some prefer to listen while walking the dog. The audio and the text are the same — this isn't a conversational podcast, it's essays that happen to be read aloud.

New episodes weekly. No interviews. No news. No market predictions. Just one short idea at a time about what trading actually is, written for people who've already decided to take it seriously.`;

/** Episodes 005–012 have hardcoded scheduled pubDates so they drip
 *  out on weekdays starting Mon Apr 20. After the schedule is
 *  exhausted, new episodes use their MDX `published` date. */
const SCHEDULED_PUB_DATES: Record<number, string> = {
  5: "Mon, 20 Apr 2026 13:00:00 GMT",
  6: "Tue, 21 Apr 2026 13:00:00 GMT",
  7: "Wed, 22 Apr 2026 13:00:00 GMT",
  8: "Thu, 23 Apr 2026 13:00:00 GMT",
  9: "Fri, 24 Apr 2026 13:00:00 GMT",
  10: "Mon, 27 Apr 2026 13:00:00 GMT",
  11: "Tue, 28 Apr 2026 13:00:00 GMT",
  12: "Wed, 29 Apr 2026 13:00:00 GMT",
};

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Convert published ISO date to RFC 822 for back-catalog episodes,
 *  or use the hardcoded schedule for 005–012. */
function pubDate(fm: EssayFrontmatter): string {
  const scheduled = SCHEDULED_PUB_DATES[fm.issue];
  if (scheduled) return scheduled;
  // Back catalog or future episodes past the schedule — use MDX date.
  // Append noon GMT so it's a morning-ET publish time.
  const d = new Date(`${fm.published}T13:00:00Z`);
  return d.toUTCString();
}

/** Escape text for safe embedding in XML. */
function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Format seconds as HH:MM:SS for itunes:duration. */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** HEAD request to get Content-Length for enclosure. Falls back to 0. */
async function audioBytes(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const cl = res.headers.get("content-length");
    return cl ? parseInt(cl, 10) : 0;
  } catch {
    return 0;
  }
}

export async function GET() {
  const allEssays = await listEssays();

  // Filter to episodes with audio, sort ascending by issue number.
  const episodes = allEssays
    .filter((e) => e.audio_url)
    .sort((a, b) => a.issue - b.issue);

  // Fetch all enclosure sizes in parallel.
  const sizes = await Promise.all(episodes.map((e) => audioBytes(e.audio_url!)));

  const items = episodes.map((fm, i) => {
    const durationTag =
      typeof (fm as Record<string, unknown>).audio_duration_seconds === "number"
        ? `      <itunes:duration>${formatDuration((fm as Record<string, unknown>).audio_duration_seconds as number)}</itunes:duration>\n`
        : "";

    return `    <item>
      <title><![CDATA[${fm.issue}: ${fm.title}]]></title>
      <description><![CDATA[${fm.dek}]]></description>
      <pubDate>${pubDate(fm)}</pubDate>
      <enclosure url="${escXml(fm.audio_url!)}" length="${sizes[i]}" type="audio/mp4"/>
      <guid isPermaLink="false">longboard-essay-${pad3(fm.issue)}</guid>
      <itunes:author>Rob Booker</itunes:author>
${durationTag}      <itunes:episode>${fm.issue}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <link>${SITE}/learn/${fm.slug}</link>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The New Traders Podcast</title>
    <link>${SITE}/learn</link>
    <language>en-us</language>
    <copyright>Copyright 2026 Rob Booker</copyright>
    <itunes:author>Rob Booker</itunes:author>
    <itunes:summary><![CDATA[${LONG_DESC}]]></itunes:summary>
    <description><![CDATA[${SHORT_DESC}]]></description>
    <itunes:owner>
      <itunes:name>Rob Booker</itunes:name>
      <itunes:email>madspreadsheets@gmail.com</itunes:email>
    </itunes:owner>
    <itunes:image href="${COVER_URL}"/>
    <itunes:category text="Business">
      <itunes:category text="Investing"/>
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <link rel="self" href="${FEED_URL}" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
