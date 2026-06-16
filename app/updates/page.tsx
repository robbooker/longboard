import type { Metadata } from "next";
import Link from "next/link";
import { productUpdates } from "@/lib/productUpdates";
import "./updates.css";

export const metadata: Metadata = {
  title: "Product Updates · Longboard",
  description:
    "A running log of Longboard product improvements, releases, and member-facing changes.",
  openGraph: {
    title: "Product Updates · Longboard",
    description:
      "A running log of Longboard product improvements, releases, and member-facing changes.",
    type: "website",
    url: "/updates",
  },
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T12:00:00Z`));
}

export default function ProductUpdatesPage() {
  const latest = productUpdates[0];

  return (
    <main className="product-updates-page">
      <header className="updates-topbar">
        <Link href="/" className="updates-wordmark" aria-label="Longboard home">
          LONGBOARD<span>AI</span>
        </Link>
        <nav className="updates-nav" aria-label="Product updates navigation">
          <Link href="/learn">Learn</Link>
          <Link href="/charts">Charts</Link>
          <Link href="/login">Member sign in</Link>
        </nav>
      </header>

      <section className="updates-hero">
        <div>
          <p className="updates-kicker">Release notes</p>
          <h1>Product Updates</h1>
          <p className="updates-dek">
            A running log of what changed on Longboard: chart tools, member
            features, workflow improvements, and the small details that make the
            product feel better to use.
          </p>
        </div>
        {latest && (
          <aside className="updates-latest" aria-label="Latest product update">
            <span>Latest</span>
            <strong>{latest.title}</strong>
            <p>{formatDate(latest.date)}</p>
          </aside>
        )}
      </section>

      <section className="updates-timeline" aria-label="Longboard product update timeline">
        {productUpdates.map((update) => (
          <article className="updates-entry" key={`${update.date}-${update.title}`}>
            <div className="updates-date">
              <time dateTime={update.date}>{formatDate(update.date)}</time>
              <span>{update.label}</span>
            </div>
            <div className="updates-entry-body">
              <h2>{update.title}</h2>
              <p>{update.summary}</p>
              <ul>
                {update.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              {update.links && update.links.length > 0 && (
                <div className="updates-actions">
                  {update.links.map((link) => (
                    <Link href={link.href} key={link.href}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
