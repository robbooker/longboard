import ReadingProgress from "@/components/essays/ReadingProgress";

/** Detail-page wrapper inside the parent /business layout. Adds the
 *  reading progress bar at the top of the article. The .essay-page
 *  scope is provided by the parent layout — this just nests
 *  ReadingProgress before children. CSS uses descendant selector
 *  (.essay-page .essay-progress) so the visual position matches
 *  /learn/[slug] regardless of nesting depth. */
export default function BusinessDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ReadingProgress />
      {children}
    </>
  );
}
