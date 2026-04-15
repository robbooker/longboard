type Props = {
  items: string[];
};

/** Numbered sources block at essay end. Authored content, so inline
 *  HTML (`<em>`) is allowed and rendered via dangerouslySetInnerHTML.
 *  The numbering + divider comes from the scoped CSS. */
export default function Sources({ items }: Props) {
  if (!items || items.length === 0) return null;
  return (
    <section className="sources">
      <div className="label">Sources</div>
      <ol>
        {items.map((s, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: s }} />
        ))}
      </ol>
    </section>
  );
}
