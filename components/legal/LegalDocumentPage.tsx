import Link from "next/link";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalDocumentPageProps = {
  title: string;
  eyebrow: string;
  description: string;
  updated: string;
  sections: LegalSection[];
};

function renderLinkedText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);

  return parts.map((part, index) => {
    if (!/^https?:\/\//.test(part)) return part;
    const href = part.replace(/[.,;:]+$/, "");
    const suffix = part.slice(href.length);

    return (
      <a href={href} key={`${part}-${index}`}>
        {href}
        {suffix}
      </a>
    );
  });
}

export default function LegalDocumentPage({
  title,
  eyebrow,
  description,
  updated,
  sections,
}: LegalDocumentPageProps) {
  return (
    <main className="legal-page">
      <style>{`
        .legal-page {
          --cream:#F6F2E9;
          --card:#FBF8F0;
          --ink:#15120B;
          --ink-72:rgba(21,18,11,0.72);
          --ink-56:rgba(21,18,11,0.56);
          --ink-20:rgba(21,18,11,0.20);
          --amber:#F5A524;
          --gold:#B8860B;
          min-height:100vh;
          background:var(--cream);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .legal-page * { box-sizing:border-box; }
        .legal-page a { color:inherit; }
        .legal-wrap {
          width:min(100%, 940px);
          margin:0 auto;
          padding:28px clamp(20px, 5vw, 56px) 72px;
        }
        .legal-top {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          border-bottom:1px solid var(--ink-20);
          padding-bottom:22px;
          margin-bottom:clamp(44px, 8vw, 76px);
        }
        .legal-brand {
          display:flex;
          align-items:center;
          gap:10px;
          font-family:'Courier New',Courier,monospace;
          font-size:12px;
          font-weight:700;
          letter-spacing:2px;
          text-transform:uppercase;
          text-decoration:none;
        }
        .legal-mark {
          width:28px;
          height:28px;
          display:grid;
          place-items:center;
          background:var(--amber);
          color:var(--cream);
          font-family:Georgia,'Times New Roman',serif;
          font-size:22px;
          line-height:1;
        }
        .legal-nav {
          display:flex;
          gap:18px;
          font-family:'Courier New',Courier,monospace;
          font-size:11px;
          font-weight:700;
          letter-spacing:1.8px;
          text-transform:uppercase;
        }
        .legal-nav a {
          text-decoration:none;
          border-bottom:1px solid transparent;
        }
        .legal-nav a:hover { border-bottom-color:var(--gold); }
        .legal-hero {
          border-bottom:1px solid var(--ink-20);
          padding-bottom:clamp(36px, 6vw, 58px);
          margin-bottom:clamp(34px, 5vw, 48px);
        }
        .legal-eyebrow {
          margin:0 0 18px;
          color:var(--gold);
          font-family:'Courier New',Courier,monospace;
          font-size:12px;
          font-weight:700;
          letter-spacing:2px;
          text-transform:uppercase;
        }
        .legal-hero h1 {
          margin:0;
          max-width:12ch;
          font-size:clamp(48px, 9vw, 92px);
          line-height:0.9;
          letter-spacing:0;
        }
        .legal-hero p {
          max-width:66ch;
          margin:24px 0 0;
          color:var(--ink-72);
          font-size:clamp(17px, 2vw, 21px);
          line-height:1.55;
        }
        .legal-updated {
          margin-top:22px;
          color:var(--ink-56);
          font-family:'Courier New',Courier,monospace;
          font-size:12px;
          font-weight:700;
          letter-spacing:1.6px;
          text-transform:uppercase;
        }
        .legal-section {
          display:grid;
          grid-template-columns:minmax(0, 220px) minmax(0, 1fr);
          gap:clamp(22px, 5vw, 48px);
          padding:clamp(28px, 5vw, 44px) 0;
          border-bottom:1px solid var(--ink-20);
        }
        .legal-section h2 {
          margin:0;
          font-size:clamp(20px, 2.6vw, 27px);
          line-height:1.08;
          letter-spacing:0;
        }
        .legal-copy p {
          margin:0;
          color:var(--ink-72);
          font-size:16px;
          line-height:1.72;
        }
        .legal-copy p + p { margin-top:16px; }
        .legal-copy ul {
          margin:0;
          padding:0;
          list-style:none;
          display:grid;
          gap:12px;
        }
        .legal-copy p + ul,
        .legal-copy ul + p {
          margin-top:16px;
        }
        .legal-copy li {
          position:relative;
          padding-left:22px;
          color:var(--ink-72);
          font-size:16px;
          line-height:1.6;
        }
        .legal-copy li::before {
          content:"";
          position:absolute;
          left:0;
          top:0.75em;
          width:7px;
          height:7px;
          background:var(--gold);
        }
        .legal-foot {
          display:flex;
          flex-wrap:wrap;
          align-items:center;
          justify-content:space-between;
          gap:18px;
          padding-top:34px;
          color:var(--ink-56);
          font-family:'Courier New',Courier,monospace;
          font-size:11px;
          font-weight:700;
          letter-spacing:1.7px;
          text-transform:uppercase;
        }
        .legal-foot-links {
          display:flex;
          gap:16px;
        }
        .legal-foot a { text-decoration:none; }
        .legal-foot a:hover { color:var(--ink); }
        @media (max-width: 720px) {
          .legal-top {
            align-items:flex-start;
            flex-direction:column;
          }
          .legal-nav {
            flex-wrap:wrap;
            gap:12px 16px;
          }
          .legal-section {
            grid-template-columns:1fr;
            gap:14px;
          }
        }
      `}</style>

      <div className="legal-wrap">
        <header className="legal-top">
          <Link href="/" className="legal-brand" aria-label="Longboard AI home">
            <span className="legal-mark">L</span>
            <span>Longboard AI</span>
          </Link>
          <nav className="legal-nav" aria-label="Legal pages">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:contact@longboardai.com">Contact</a>
          </nav>
        </header>

        <section className="legal-hero">
          <p className="legal-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="legal-updated">Effective {updated}</div>
        </section>

        {sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{section.title}</h2>
            <div className="legal-copy">
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{renderLinkedText(paragraph)}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{renderLinkedText(bullet)}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}

        <footer className="legal-foot">
          <span>&copy; Longboard AI 2026</span>
          <span className="legal-foot-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
