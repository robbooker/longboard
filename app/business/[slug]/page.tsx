import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import BusinessMasthead from "@/components/business/BusinessMasthead";
import BusinessHero from "@/components/business/BusinessHero";
import BusinessFooter from "@/components/business/BusinessFooter";
import UpdateList from "@/components/business/UpdateList";
import { essayMdxComponents } from "@/components/essays/mdx-components";
import ReadingView from "@/components/ReadingView";
import { listBusinessUpdates, loadBusinessUpdate, monthYear } from "@/lib/business";
import { isPublished } from "@/lib/publishing";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const update = await loadBusinessUpdate(slug, { includeScheduled: true });
  if (!update) return {};
  const title = `${update.frontmatter.title} · Longboard Business`;
  return {
    title,
    description: update.frontmatter.dek,
    openGraph: {
      title,
      description: update.frontmatter.dek,
      type: "article",
      url: `/business/${update.frontmatter.slug}`,
      publishedTime: update.frontmatter.publish_at ?? update.frontmatter.published,
      authors: ["Rob Booker"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: update.frontmatter.dek,
    },
  };
}

export default async function BusinessUpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [update, allUpdates] = await Promise.all([
    loadBusinessUpdate(slug, { includeScheduled: true }),
    listBusinessUpdates({ includeScheduled: true }),
  ]);
  if (!update) notFound();

  const { frontmatter, body } = update;
  const mY = monthYear(frontmatter.published);
  const isPreview = !isPublished(frontmatter.publish_at);

  const previewDate = frontmatter.publish_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(frontmatter.publish_at))
    : "";

  return (
    <>
      {isPreview && (
        <div style={{
          fontFamily: "var(--font-ibm-plex-mono), ui-monospace, monospace",
          fontSize: 12,
          letterSpacing: "0.04em",
          color: "var(--warning, #ffb020)",
          background: "var(--warning-10, rgba(255,176,32,0.1))",
          borderTop: "1px solid var(--warning, #ffb020)",
          borderBottom: "1px solid var(--warning, #ffb020)",
          padding: "8px 24px",
          textAlign: "center",
        }}>
          [ADMIN PREVIEW] This update is scheduled for {previewDate}. Not visible to the public yet.
        </div>
      )}
      <ReadingView
        backLink={
          <div className="back-to-daily">
            <Link href="/business">&larr; All updates</Link>
          </div>
        }
        masthead={
          <BusinessMasthead monthYear={mY} readMinutes={frontmatter.read_minutes} />
        }
        hero={
          <BusinessHero
            kicker={frontmatter.kicker}
            title={frontmatter.title}
            dek={frontmatter.dek}
            author="Rob Booker"
            published={frontmatter.published}
          />
        }
        audioUrl={frontmatter.audio_url}
        bodyMdx={body}
        mdxComponents={essayMdxComponents}
        rightSidebar={
          <UpdateList
            items={allUpdates.map((u) => ({
              slug: u.slug,
              title: u.title,
              published: u.published,
              read_minutes: u.read_minutes,
            }))}
            activeSlug={frontmatter.slug}
          />
        }
        share={{ slug: frontmatter.slug, title: frontmatter.title }}
        footer={<BusinessFooter monthYear={mY} />}
        articleClassName="no-sections"
      />
    </>
  );
}
