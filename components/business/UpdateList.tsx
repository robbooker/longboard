import Link from "next/link";

export type UpdateListItem = {
  slug: string;
  title: string;
  published: string;
  read_minutes: number;
};

type Props = {
  items: UpdateListItem[];
  /** Slug of the currently-rendered update. The matching row gets the
   *  active treatment (moss left border + moss-soft tint). */
  activeSlug: string;
};

/** Right-side rail for /business/[slug]. Slots into the
 *  .marginalia-right grid column so the existing essay layout's
 *  3-column grid (left-marginalia / article / right-marginalia)
 *  takes care of placement. The .update-list-aside class layers
 *  sticky-on-desktop positioning on top.
 *
 *  Mobile: the existing .marginalia-right @media collapse stacks
 *  everything below the article naturally. The rail's CSS resets
 *  position back to static at narrow viewports. */
export default function UpdateList({ items, activeSlug }: Props) {
  if (items.length === 0) {
    return <aside className="update-list-aside marginalia-right" />;
  }
  return (
    <aside className="update-list-aside marginalia-right">
      <div className="update-list-head">All updates</div>
      <ol className="update-list">
        {items.map((u) => {
          const active = u.slug === activeSlug;
          return (
            <li key={u.slug}>
              <Link
                href={`/business/${u.slug}`}
                className={active ? "update-list-item active" : "update-list-item"}
                aria-current={active ? "page" : undefined}
              >
                <div className="update-list-item-title">{u.title}</div>
                <div className="update-list-item-meta">
                  {u.published} · {u.read_minutes} min
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
