type Props = {
  kicker: string;
  title: string;
  /** The tail of `title` to render in italic moss. Must appear at the
   *  end of `title` — otherwise the accent is dropped silently and the
   *  title renders whole, without the split. */
  titleAccent: string;
  dek: string;
  author: string;
  issueNo: number;
  issueLabel: string;
  filedUnder: string;
};

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export default function EssayHero({
  kicker,
  title,
  titleAccent,
  dek,
  author,
  issueNo,
  issueLabel,
  filedUnder,
}: Props) {
  // Split the title into the leading part + the italic accent tail.
  const hasAccent = titleAccent && title.endsWith(titleAccent);
  const head = hasAccent ? title.slice(0, title.length - titleAccent.length).trimEnd() : title;

  return (
    <section className="hero">
      <div className="kicker">{kicker}</div>
      <h1>
        {head}
        {hasAccent && (
          <>
            {" "}
            <span className="accent">{titleAccent}</span>
          </>
        )}
      </h1>
      <p className="dek">{dek}</p>
      <div className="byline">
        <span>
          <strong>By {author}</strong>
        </span>
        <span>
          Issue {pad3(issueNo)} · {issueLabel}
        </span>
        <span>
          Filed under <em>{filedUnder}</em>
        </span>
      </div>
    </section>
  );
}
