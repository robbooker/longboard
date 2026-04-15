import "./essay-styles.css";
import ReadingProgress from "@/components/essays/ReadingProgress";

/** Wraps every /learn/* route in the editorial aesthetic. Paper
 *  background + serif stack + grain overlay live on `.essay-page`;
 *  child routes render inside `.essay-page-content` so the fixed
 *  ::before grain stays behind the content layer. */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="essay-page">
      <ReadingProgress />
      <div className="essay-page-content">{children}</div>
    </div>
  );
}
