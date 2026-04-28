import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt = "Longboard Essays — long-form on trading process, risk, and restraint.";

/** Generic OG card for the /learn index. Same paper aesthetic as the
 *  per-essay cards, different content: series headline + generic dek
 *  instead of slug-specific frontmatter. Uses the same font-loading
 *  path so Vercel caches one font fetch per card build. */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#F6F2E9",
          padding: "56px 72px",
          color: "#15120B",
          fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif",
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
            color: "rgba(21, 18, 11, 0.62)",
            fontFamily: "\"Courier New\", Courier, ui-monospace, monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 48, height: 2, backgroundColor: "#F5A524", marginRight: 18 }} />
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
              fontSize: 104,
              lineHeight: 0.98,
              letterSpacing: -5,
              fontWeight: 800,
              color: "#15120B",
              marginBottom: 32,
            }}
          >
            <span>Essays</span>
            <span style={{ fontStyle: "italic", fontFamily: "Georgia, \"Times New Roman\", serif", fontWeight: 500, color: "#B8860B", marginLeft: 18 }}>on process.</span>
          </div>

          <div
            style={{
              display: "flex",
              fontStyle: "italic",
              fontSize: 30,
              lineHeight: 1.4,
              fontFamily: "Georgia, \"Times New Roman\", serif",
              fontWeight: 500,
              color: "rgba(21, 18, 11, 0.62)",
              maxWidth: 980,
            }}
          >
            Long-form writing on the mechanics of trading. Restraint, size, the disposition effect, and the habit of asking a good trade to become a perfect one.
          </div>
        </div>

        {/* Hairline + footer. */}
        <div style={{ display: "flex", width: 120, height: 1, backgroundColor: "rgba(21, 18, 11, 0.16)", marginBottom: 22 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 18,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(21, 18, 11, 0.62)",
            fontFamily: "\"Courier New\", Courier, ui-monospace, monospace",
          }}
        >
          <span style={{ color: "#15120B" }}>By Rob Booker</span>
          <span>longboardai.com</span>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
