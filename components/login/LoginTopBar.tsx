import Link from "next/link";

export default function LoginTopBar() {
  return (
    <div className="lpt-root">
      <style>{`
        .lpt-root{
          --ink:#15120B;
          --ink-30:rgba(21,18,11,0.16);
          --amber:#F5A524;
          --gold:#B8860B;
          --font-display:Helvetica,Arial,sans-serif;
          --font-serif:Georgia,'Times New Roman',serif;
          padding:18px 28px;
          border-bottom:1px solid var(--ink-30);
          color:var(--ink);
          -webkit-font-smoothing:antialiased;
        }
        .lpt-root *{box-sizing:border-box}
        .lpt-root a{color:inherit;text-decoration:none}
        .lpt-root .lpt-inner{
          display:flex;
          align-items:center;
          width:100%;
          max-width:1080px;
          margin:0 auto;
        }
        .lpt-root .lpt-wordmark{
          display:inline-flex;
          align-items:center;
          gap:10px;
          font-family:var(--font-display);
          font-weight:800;
          font-size:18px;
          letter-spacing:-0.4px;
          color:var(--ink);
          transition:opacity .12s ease;
        }
        .lpt-root .lpt-wordmark:hover{opacity:.7}
        .lpt-root .lpt-mark{
          width:26px;
          height:26px;
          background:var(--amber);
          color:var(--ink);
          display:inline-flex;
          align-items:center;
          justify-content:center;
          font-weight:900;
          font-size:14px;
          border:1.5px solid var(--ink);
        }
        .lpt-root .lpt-wordmark em{
          font-family:var(--font-serif);
          font-style:italic;
          font-weight:500;
          color:var(--gold);
        }
        @media (max-width:768px){
          .lpt-root{padding:16px 16px}
        }
      `}</style>
      <div className="lpt-inner">
        <Link href="/" className="lpt-wordmark">
          <span className="lpt-mark">L</span>
          <span>LONGBOARD<em>AI</em></span>
        </Link>
      </div>
    </div>
  );
}
