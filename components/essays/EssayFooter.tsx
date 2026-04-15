type Props = {
  issueNo: number;
  monthYear: string;
};

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export default function EssayFooter({ issueNo, monthYear }: Props) {
  return (
    <footer className="footer">
      <div className="footer-end">— end —</div>
      <div className="footer-meta">
        Longboard Essays · No. {pad3(issueNo)} · {monthYear}
      </div>
    </footer>
  );
}
