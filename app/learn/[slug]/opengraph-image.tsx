import { ImageResponse } from "next/og";
import { loadEssay, monthYear } from "@/lib/essays";
import { loadGoogleFont } from "@/lib/og-fonts";

// Edge runtime would let dynamic cold-path requests render faster, but
// loadEssay reads the filesystem (content/essays/*.mdx), which edge
// doesn't support. Since every slug comes from the page's
// generateStaticParams, Next pre-renders these at build time on Node
// and serves cached PNGs via the Vercel CDN — so cold-start cost is
// effectively zero regardless of runtime hint.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt = "Longboard Essay";

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Dynamic OG card for each /learn/[slug]. Mirrors the essay's paper
 *  aesthetic: paper bg, rust kicker strip, Fraunces title with the
 *  italic-moss accent split, mono byline footer. Satori (the engine
 *  behind ImageResponse) supports a subset of CSS, so every container
 *  with multiple children needs an explicit display:"flex", and all
 *  colors are inlined rather than going through CSS vars. */
export default async function Image({ params }: { params: { slug: string } }) {
  const essay = await loadEssay(params.slug);
  if (!essay) {
    // 404 OG — plain paper card, no essay data. Keeps link-unfurlers
    // from breaking with a 500 when they preview a dead slug.
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f3e8d2",
            color: "#826d52",
            fontSize: 36,
            fontFamily: "serif",
          }}
        >
          Essay not found
        </div>
      ),
      size,
    );
  }

  const fm = essay.frontmatter;
  const my = monthYear(fm.published);
  const hasAccent = fm.title_accent && fm.title.endsWith(fm.title_accent);
  const titleHead = hasAccent ? fm.title.slice(0, fm.title.length - fm.title_accent.length).trimEnd() : fm.title;
  const titleAccent = hasAccent ? fm.title_accent : "";

  // Subset text — tells Google Fonts which glyphs to include.
  const subsetText = [
    "Longboard Essays",
    `No. ${pad3(fm.issue)}`,
    fm.title,
    fm.dek,
    "By Rob Booker",
    `Issue ${pad3(fm.issue)} · ${fm.issue_label}`,
    `${my} · ${fm.read_minutes} min read`,
  ].join(" ");

  const [fraunces500, frauncesItalic400, mono500] = await Promise.all([
    loadGoogleFont({ family: "Fraunces", axes: "wght@500", text: subsetText }),
    loadGoogleFont({ family: "Fraunces", axes: "ital,wght@1,400", text: subsetText }),
    loadGoogleFont({ family: "JetBrains Mono", axes: "wght@500", text: subsetText }),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f3e8d2",
          backgroundImage:
            "radial-gradient(ellipse 900px 500px at 18% -5%, rgba(255,245,220,0.7), transparent 65%), radial-gradient(ellipse 700px 400px at 95% 100%, rgba(26,77,54,0.08), transparent 60%)",
          padding: "56px 72px",
          color: "#1d1610",
          fontFamily: "JetBrains Mono",
        }}
      >
        {/* Top strip — brand left, issue number right. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#826d52",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 48, height: 2, backgroundColor: "#a4421a", marginRight: 18 }} />
            <span>Longboard Essays</span>
          </div>
          <span>No. {pad3(fm.issue)}</span>
        </div>

        {/* Title block — fills mid. */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", paddingTop: 20 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontFamily: "Fraunces",
              fontSize: 88,
              lineHeight: 1.02,
              letterSpacing: -3,
              color: "#1d1610",
              marginBottom: 32,
            }}
          >
            <span>{titleHead}</span>
            {titleAccent && (
              <span style={{ fontStyle: "italic", color: "#0f3525", marginLeft: 18 }}>{titleAccent}</span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontStyle: "italic",
              fontSize: 30,
              lineHeight: 1.4,
              color: "#443628",
              maxWidth: 980,
            }}
          >
            {fm.dek}
          </div>
        </div>

        {/* Rust hairline above the footer row. */}
        <div style={{ display: "flex", width: 120, height: 1, backgroundColor: "#a4421a", marginBottom: 22 }} />

        {/* Footer row — byline + time left, issue label right. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 18,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#826d52",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#1d1610" }}>By Rob Booker</span>
            <span style={{ marginTop: 8 }}>
              {my} · {fm.read_minutes} min read
            </span>
          </div>
          <span>
            Issue {pad3(fm.issue)} · {fm.issue_label}
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: fraunces500, weight: 500, style: "normal" },
        { name: "Fraunces", data: frauncesItalic400, weight: 400, style: "italic" },
        { name: "JetBrains Mono", data: mono500, weight: 500, style: "normal" },
      ],
    },
  );
}
