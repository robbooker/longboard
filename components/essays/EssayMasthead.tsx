import Link from "next/link";

type Props = {
  issueNo: number;
  monthYear: string;
  readMinutes: number;
};

/** Formats "No. 001" — padded to three digits so every issue number
 *  renders at the same visual width in the masthead meta row. */
function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export default function EssayMasthead({ issueNo, monthYear, readMinutes }: Props) {
  return (
    <header className="masthead">
      <Link href="/learn" className="masthead-brand">
        Longboard <em>Essays</em>
      </Link>
      <div className="masthead-meta">
        <span>No. {pad3(issueNo)}</span>
        <span>{monthYear}</span>
        <span>Reading · {readMinutes} min</span>
      </div>
    </header>
  );
}
