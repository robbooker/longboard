import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import EssayMasthead from "@/components/essays/EssayMasthead";
import EssayHero from "@/components/essays/EssayHero";
import EssayFooter from "@/components/essays/EssayFooter";
import Marginalia from "@/components/essays/Marginalia";
import Sources from "@/components/essays/Sources";
import { essayMdxComponents } from "@/components/essays/mdx-components";
import { listEssaySlugs, loadEssay, monthYear } from "@/lib/essays";

export async function generateStaticParams() {
  const slugs = await listEssaySlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const essay = await loadEssay(slug);
  if (!essay) return {};
  const title = `${essay.frontmatter.title} · Longboard Essays`;
  // Next auto-wires the sibling opengraph-image.tsx as the og:image
  // URL — no need to set images explicitly. Setting openGraph
  // title/description/type/url makes the unfurl match the card
  // content rather than defaulting to the bare page metadata.
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
    },
  };
}

export default async function EssayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const essay = await loadEssay(slug);
  if (!essay) notFound();

  const { frontmatter, body } = essay;
  const mY = monthYear(frontmatter.published);

  // Split marginalia across left/right columns to match the reference
  // HTML's visual rhythm. Odd-indexed notes land left, even-indexed
  // right — keeps both columns roughly balanced when there are 4+
  // notes, and puts the first note on the left so it's discoverable
  // near the article's top.
  const leftNotes = (frontmatter.marginalia ?? []).filter((_, i) => i % 2 === 0);
  const rightNotes = (frontmatter.marginalia ?? []).filter((_, i) => i % 2 === 1);

  return (
    <>
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
      <main className="content">
        <Marginalia notes={leftNotes} side="left" />
        <article className="article">
          <MDXRemote source={body} components={essayMdxComponents} />
          <Sources items={frontmatter.sources ?? []} />
        </article>
        <Marginalia notes={rightNotes} side="right" />
      </main>
      <EssayFooter issueNo={frontmatter.issue} monthYear={mY} />
    </>
  );
}
