type Note = { label: string; body: string };

type Props = {
  notes: Note[];
  side: "left" | "right";
};

/** Sticky margin-note column. Hidden on the left side below 980px
 *  via CSS; the right column stacks inline under the article body on
 *  mobile. Labels + bodies are plain strings — authors who want
 *  emphasis use `<em>…</em>` inline in the frontmatter body, which
 *  the CSS recolors to moss. Trusted authored content, so HTML is
 *  allowed via dangerouslySetInnerHTML. */
export default function Marginalia({ notes, side }: Props) {
  if (!notes || notes.length === 0) return <aside className={`marginalia-${side}`} />;
  return (
    <aside className={`marginalia-${side}`}>
      {notes.map((n, i) => (
        <div key={i} className="margin-block">
          <div className="margin-note">
            <span className="label">{n.label}</span>
            <span dangerouslySetInnerHTML={{ __html: n.body }} />
          </div>
        </div>
      ))}
    </aside>
  );
}
