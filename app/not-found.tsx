import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", padding: "64px 24px", background: "var(--bg)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "var(--font-labels)" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace", letterSpacing: 3, textTransform: "uppercase", color: "var(--text-secondary)", fontSize: 12 }}>
          ● Longboard
        </div>
        <h1 style={{ fontSize: 56, lineHeight: 0.98, letterSpacing: -4, margin: "18px 0 12px", fontWeight: 800 }}>
          Page not found.
        </h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 16, lineHeight: 1.6 }}>
          The route exists in neither the nav nor the archive.
        </p>
        <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid var(--border)",
              textDecoration: "none",
              color: "var(--text-primary)",
              fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            Home
          </Link>
          <Link
            href="/workspace"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid var(--border)",
              textDecoration: "none",
              color: "var(--text-primary)",
              fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            Workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

