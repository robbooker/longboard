import "../essay-styles.css";
import ReadingProgress from "@/components/essays/ReadingProgress";

/** Wraps essay detail pages in the editorial paper aesthetic. Pulled
 *  down from app/learn/layout.tsx in Phase 3L so the /learn index
 *  (now the Daily homepage) can own its own scoped surface without
 *  inheriting the essay chrome. The /command2 dark top nav now lives
 *  in app/learn/layout.tsx so both /learn and /learn/[slug] get it. */
export default function EssayDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="essay-page">
      <ReadingProgress />
      <div className="essay-page-content">{children}</div>
    </div>
  );
}
