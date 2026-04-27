import Link from "next/link";

type Props = {
  /** Detail page passes both. Index page passes neither (renders
   *  "All updates" on the right side for visual balance). */
  monthYear?: string;
  readMinutes?: number;
};

/** Top-of-page chrome for /business surfaces. Mirrors the visual
 *  shape of EssayMasthead — same .masthead, .masthead-brand,
 *  .masthead-meta classes from essay-styles.css — but swaps the
 *  brand text to "Longboard Business" and shows two meta items
 *  instead of three (no issue number for business updates). */
export default function BusinessMasthead({ monthYear, readMinutes }: Props) {
  const isDetail = monthYear !== undefined || typeof readMinutes === "number";
  return (
    <header className="masthead">
      <Link href="/business" className="masthead-brand">
        Longboard <em>Business</em>
      </Link>
      <div className="masthead-meta">
        {isDetail ? (
          <>
            {monthYear && <span>{monthYear}</span>}
            {typeof readMinutes === "number" && <span>Reading · {readMinutes} min</span>}
          </>
        ) : (
          <span>All updates</span>
        )}
      </div>
    </header>
  );
}
