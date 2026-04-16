import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/lib/og-fonts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt = "Longboard Essays — long-form on trading process, risk, and restraint.";

/** Generic OG card for the /learn index. Same paper aesthetic as the
 *  per-essay cards, different content: series headline + generic dek
 *  instead of slug-specific frontmatter. Uses the same font-loading
 *  path so Vercel caches one font fetch per card build. */
export default async function Image() {
  const subsetText = "Longboard Essays Long-form on trading process, risk, and restraint. Issues 001–004 · 2026 An archive of essays on process. The market does not pay you for a good retrospective story.";

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
        {/* Top strip — matches the per-essay card. */}
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
          <span>Long-form · Archive</span>
        </div>

        {/* Title block. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            paddingTop: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontFamily: "Fraunces",
              fontSize: 104,
              lineHeight: 1.02,
              letterSpacing: -4,
              color: "#1d1610",
              marginBottom: 32,
            }}
          >
            <span>Essays</span>
            <span style={{ fontStyle: "italic", color: "#0f3525", marginLeft: 18 }}>on process.</span>
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
            Long-form writing on the mechanics of trading. Restraint, size, the disposition effect, and the habit of asking a good trade to become a perfect one.
          </div>
        </div>

        {/* Hairline + footer. */}
        <div style={{ display: "flex", width: 120, height: 1, backgroundColor: "#a4421a", marginBottom: 22 }} />
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
          <span style={{ color: "#1d1610" }}>By Rob Booker</span>
          <span>longboardai.com</span>
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
