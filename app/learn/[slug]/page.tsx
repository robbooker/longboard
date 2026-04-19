import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import EssayMasthead from "@/components/essays/EssayMasthead";
import EssayHero from "@/components/essays/EssayHero";
import EssayFooter from "@/components/essays/EssayFooter";
import Marginalia from "@/components/essays/Marginalia";
import Sources from "@/components/essays/Sources";
import EssayAudioPlayer from "@/components/essays/EssayAudioPlayer";
import ShareSection from "@/components/essays/ShareSection";
import { essayMdxComponents } from "@/components/essays/mdx-components";
import { loadEssay, monthYear } from "@/lib/essays";
import { isPublished } from "@/lib/publishing";

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const essay = await loadEssay(slug, { includeScheduled: true });
  if (!essay) return {};
  const title = `${essay.frontmatter.title} · Longboard Essays`;
  const ogImage = `/og/${essay.frontmatter.slug}-b-og.png`;
  return {
    title,
    description: essay.frontmatter.dek,
    openGraph: {
      title,
      description: essay.frontmatter.dek,
      type: "article",
      url: `/learn/${essay.frontmatter.slug}`,
      publishedTime: essay.frontmatter.published,
      authors: ["Rob Booker"],
      images: [{ url: ogImage, width: 1200, height: 630, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: essay.frontmatter.dek,
      images: [ogImage],
    },
    alternates: {
      types: { "application/rss+xml": "/podcast.xml" },
    },
  };
}

export default async function EssayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const essay = await loadEssay(slug, { includeScheduled: true });
  if (!essay) notFound();

  const { frontmatter, body } = essay;
  const mY = monthYear(frontmatter.published);
  const isPreview = !isPublished(frontmatter.publish_at);

  // Split marginalia across left/right columns to match the reference
  // HTML's visual rhythm. Odd-indexed notes land left, even-indexed
  // right — keeps both columns roughly balanced when there are 4+
  // notes, and puts the first note on the left so it's discoverable
  // near the article's top.
  const leftNotes = (frontmatter.marginalia ?? []).filter((_, i) => i % 2 === 0);
  const rightNotes = (frontmatter.marginalia ?? []).filter((_, i) => i % 2 === 1);

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
          [ADMIN PREVIEW] This essay is scheduled for {previewDate}. Not visible to the public yet.
        </div>
      )}
      <div className="back-to-daily">
        <Link href="/learn">&larr; Back to Daily</Link>
      </div>
      <EssayMasthead issueNo={frontmatter.issue} monthYear={mY} readMinutes={frontmatter.read_minutes} />
      <EssayHero
        kicker={frontmatter.kicker}
        title={frontmatter.title}
        titleAccent={frontmatter.title_accent}
        dek={frontmatter.dek}
        author="Rob Booker"
        issueNo={frontmatter.issue}
        issueLabel={frontmatter.issue_label}
        filedUnder={frontmatter.filed_under}
      />
      {frontmatter.audio_url && <EssayAudioPlayer src={frontmatter.audio_url} />}
      <main className="content">
        <Marginalia notes={leftNotes} side="left" />
        <article className="article">
          <MDXRemote source={body} components={essayMdxComponents} />
          <Sources items={frontmatter.sources ?? []} />
        </article>
        <Marginalia notes={rightNotes} side="right" />
      </main>
      <ShareSection slug={frontmatter.slug} title={frontmatter.title} />
      <EssayFooter issueNo={frontmatter.issue} monthYear={mY} />
    </>
  );
}
