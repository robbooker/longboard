import type { Source } from "@/lib/essays";
import type { ReactNode } from "react";

type Props = {
  items: Source[];
};

/** Renders *text* as <em>text</em> in gloss strings. Only supports
 *  single-asterisk italic — not a full markdown parser. */
function renderGloss(gloss: string): ReactNode[] {
  const parts = gloss.split(/(\*[^*]+\*)/g);
  return parts.map((p, i) =>
    p.startsWith("*") && p.endsWith("*")
      ? <em key={i}>{p.slice(1, -1)}</em>
      : <span key={i}>{p}</span>
  );
}

function TitleOrLink({ source }: { source: Source }) {
  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-title-link">
        <em>{source.title}</em>
      </a>
    );
  }
  return <em>{source.title}</em>;
}

/** Numbered sources block at essay end. Structured data — no
 *  dangerouslySetInnerHTML. Numbering + dividers from scoped CSS. */
export default function Sources({ items }: Props) {
  if (!items || items.length === 0) return null;
  return (
    <section className="sources">
      <div className="label">Sources</div>
      <ol>
        {items.map((source, i) => (
          <li key={i}>
            {source.author}, <TitleOrLink source={source} /> ({source.year}) — {renderGloss(source.gloss)}
          </li>
        ))}
      </ol>
    </section>
  );
}
