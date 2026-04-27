type Props = {
  kicker?: string;
  title: string;
  dek?: string;
  author: string;
  /** Human-readable date string, e.g. "April 26, 2026". */
  published: string;
};

/** Title block for /business/[slug]. Slimmer than EssayHero — no
 *  title accent split, no issue number, no filed-under tag. Two-item
 *  byline (author + date) instead of three. Reuses essay-styles.css
 *  .hero, .kicker, .dek, .byline classes verbatim. */
export default function BusinessHero({ kicker, title, dek, author, published }: Props) {
  return (
    <section className="hero">
      {kicker && <div className="kicker">{kicker}</div>}
      <h1>{title}</h1>
      {dek && <p className="dek">{dek}</p>}
      <div className="byline">
        <span>
          <strong>By {author}</strong>
        </span>
        <span>{published}</span>
      </div>
    </section>
  );
}
