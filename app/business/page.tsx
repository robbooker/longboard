import Link from "next/link";
import type { Metadata } from "next";
import { listBusinessUpdates, monthYear } from "@/lib/business";
import BusinessMasthead from "@/components/business/BusinessMasthead";
import BusinessFooter from "@/components/business/BusinessFooter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Longboard Business · Updates",
  description: "Updates from Rob on what we're building, where the business is going, and what's next.",
  openGraph: {
    title: "Longboard Business · Updates",
    description: "Updates from Rob on what we're building, where the business is going, and what's next.",
    type: "website",
    url: "/business",
  },
};

export default async function BusinessIndexPage() {
  const updates = await listBusinessUpdates({ includeScheduled: true });
  const currentMY = monthYear(new Date().toISOString());

  return (
    <>
      <BusinessMasthead />
      <section className="hero">
        <div className="kicker">All updates</div>
        <h1>
          Longboard <span className="accent">Business</span>
        </h1>
        <p className="dek">
          Updates from Rob on what we&apos;re building, where the business is
          going, and what&apos;s next.
        </p>
      </section>

      <main className="business-index">
        {updates.length === 0 ? (
          <p className="business-empty">No updates yet.</p>
        ) : (
          <ul className="business-list">
            {updates.map((u) => (
              <li key={u.slug}>
                <Link href={`/business/${u.slug}`} className="business-list-item">
                  <h2>{u.title}</h2>
                  {u.dek && <p className="dek">{u.dek}</p>}
                  <div className="meta">
                    {u.published} · {u.read_minutes} min
                    {u.audio_url && " · ▶ audio"}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <BusinessFooter monthYear={currentMY} />
    </>
  );
}
