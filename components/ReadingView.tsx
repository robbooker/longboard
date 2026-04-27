import type { ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import { MDXRemote } from "next-mdx-remote/rsc";
import EssayAudioPlayer from "@/components/essays/EssayAudioPlayer";
import Sources from "@/components/essays/Sources";
import ShareSection from "@/components/essays/ShareSection";
import type { Source } from "@/lib/essays";

/** Shared editorial-aesthetic reading view used by both /learn/[slug]
 *  and /business/[slug]. Owns the layout primitives that both surfaces
 *  share — audio player conditional, .content grid with marginalia
 *  slots, .article wrapper with MDXRemote + Sources, optional
 *  ShareSection — and accepts page-specific chrome (back link,
 *  masthead, hero, footer) as ReactNode slots.
 *
 *  The DOM rendered by this component is intentionally identical to
 *  the inline composition that previously lived in /learn/[slug]/
 *  page.tsx — visual-diff zero is the explicit refactor target.
 *
 *  Phase 3M Commit 4. */
type ReadingViewProps = {
  /** Optional back-link slot above the masthead. /learn passes the
   *  Back-to-Daily link; /business passes Back-to-All-updates. */
  backLink?: ReactNode;
  /** Page-specific top chrome — EssayMasthead or BusinessMasthead. */
  masthead: ReactNode;
  /** Page-specific title block — EssayHero or BusinessHero. */
  hero: ReactNode;
  /** Optional audio URL. Renders EssayAudioPlayer when set. */
  audioUrl?: string;
  /** Raw MDX string for the article body. */
  bodyMdx: string;
  /** MDX component map. Both surfaces pass essayMdxComponents. */
  mdxComponents?: MDXComponents;
  /** Left grid column. Defaults to <aside className="marginalia-left" />
   *  for grid alignment when undefined. /learn passes Marginalia(left). */
  leftSidebar?: ReactNode;
  /** Right grid column. Defaults to <aside className="marginalia-right" />.
   *  /learn passes Marginalia(right); /business passes UpdateList. */
  rightSidebar?: ReactNode;
  /** Sources rendered inside .article after MDX body. /learn passes
   *  fm.sources; /business passes [] (Sources returns null on empty). */
  sources?: Source[];
  /** Optional share row below the article. */
  share?: { slug: string; title: string };
  /** Page-specific bottom chrome — EssayFooter or BusinessFooter. */
  footer: ReactNode;
  /** Modifier class on <article>. /business passes "no-sections" to
   *  suppress the auto Roman § H2 counter. */
  articleClassName?: string;
};

export default function ReadingView({
  backLink,
  masthead,
  hero,
  audioUrl,
  bodyMdx,
  mdxComponents,
  leftSidebar,
  rightSidebar,
  sources,
  share,
  footer,
  articleClassName,
}: ReadingViewProps) {
  const articleClass = articleClassName
    ? `article ${articleClassName}`
    : "article";
  return (
    <>
      {backLink}
      {masthead}
      {hero}
      {audioUrl && <EssayAudioPlayer src={audioUrl} />}
      <main className="content">
        {leftSidebar ?? <aside className="marginalia-left" />}
        <article className={articleClass}>
          <MDXRemote source={bodyMdx} components={mdxComponents} />
          <Sources items={sources ?? []} />
        </article>
        {rightSidebar ?? <aside className="marginalia-right" />}
      </main>
      {share && <ShareSection slug={share.slug} title={share.title} />}
      {footer}
    </>
  );
}
