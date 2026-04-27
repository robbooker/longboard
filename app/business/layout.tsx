import "../learn/essay-styles.css";

/** Wraps every /business surface in the editorial paper aesthetic.
 *  Both /business and /business/[slug] inherit this — the /[slug]
 *  detail layout adds <ReadingProgress /> on top, the index uses
 *  this wrapper alone. The CSS scope (.essay-page) carries the
 *  palette, fonts, masthead/hero/footer styling — same stylesheet
 *  /learn/[slug] uses. */
export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="essay-page">
      <div className="essay-page-content">{children}</div>
    </div>
  );
}
