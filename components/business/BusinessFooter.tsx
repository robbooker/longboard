type Props = {
  monthYear: string;
};

/** Bottom-of-page chrome for /business surfaces. Mirrors EssayFooter
 *  — same .footer / .footer-end / .footer-meta classes — but the meta
 *  line drops the issue number ("Longboard Business · MM YYYY"
 *  instead of "Longboard Essays · No. NNN · MM YYYY"). */
export default function BusinessFooter({ monthYear }: Props) {
  return (
    <footer className="footer">
      <div className="footer-end">— end —</div>
      <div className="footer-meta">
        Longboard Business · {monthYear}
      </div>
    </footer>
  );
}
