"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Full browser navigation — ensures freshly-written sb-* cookies
    // are sent with the request. router.push() uses Next.js internal
    // fetch which may read from a stale cookie jar.
    window.location.href = "/settings";
  };

  return (
    <div className="login-page">
      <style>{`
        .login-page {
          --cream:#F6F2E9;
          --card:#FBF8F0;
          --ink:#15120B;
          --ink-70:rgba(21,18,11,0.72);
          --ink-55:rgba(21,18,11,0.55);
          --ink-30:rgba(21,18,11,0.16);
          --amber:#F5A524;
          --gold:#B8860B;
          --paper:rgba(244,241,232,0.85);
          --paper-55:rgba(244,241,232,0.55);
          --paper-18:rgba(244,241,232,0.18);
          --font-display:Helvetica,Arial,sans-serif;
          --font-serif:Georgia,'Times New Roman',serif;
          --font-mono:'Courier New',Courier,monospace;
          background:var(--cream);
          color:var(--ink);
          font-family:var(--font-display);
          -webkit-font-smoothing:antialiased;
          min-height:100vh;
          display:flex;
          flex-direction:column;
        }
        .login-page *{box-sizing:border-box}
        .login-page a{color:inherit;text-decoration:none}

        .login-page .lp-topbar{
          padding:18px 28px;
          border-bottom:1px solid var(--ink-30);
        }
        .login-page .lp-topbar-inner{
          display:flex;
          align-items:center;
          width:100%;
          max-width:1080px;
          margin:0 auto;
        }

        .login-page .lp-main{
          flex:1;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:32px;
        }

        .login-page .lp-shell{width:100%;max-width:1080px}

        .login-page .lp-card{
          display:grid;
          grid-template-columns:1.1fr 1fr;
          background:var(--card);
          border:2px solid var(--ink);
          box-shadow:8px 8px 0 var(--ink);
          min-height:620px;
        }

        .login-page .lp-brand{
          background:var(--ink);
          color:var(--paper);
          padding:56px 48px;
          display:flex;
          flex-direction:column;
          justify-content:flex-start;
          gap:32px;
          position:relative;
          overflow:hidden;
        }
        .login-page .lp-brand-inner{position:relative;z-index:2}
        .login-page .lp-wordmark{
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
        .login-page .lp-wordmark:hover{opacity:.7}
        .login-page .lp-wordmark .lp-mark{
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
        .login-page .lp-wordmark em{
          font-family:var(--font-serif);
          font-style:italic;
          font-weight:500;
          color:var(--gold);
        }
        .login-page .lp-eyebrow-amber{
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.8px;
          text-transform:uppercase;
          font-weight:700;
          color:var(--amber);
        }
        .login-page .lp-h1{
          margin:18px 0 0;
          font-family:var(--font-display);
          font-size:clamp(36px,4.4vw,56px);
          line-height:0.98;
          letter-spacing:-1.6px;
          font-weight:800;
          color:rgba(244,241,232,0.96);
        }
        .login-page .lp-h1 .lp-h1-italic{
          font-family:var(--font-serif);
          font-style:italic;
          font-weight:500;
          letter-spacing:-1px;
          color:var(--amber);
        }
        .login-page .lp-dek{
          font-family:var(--font-serif);
          font-style:italic;
          font-size:17px;
          line-height:1.55;
          color:rgba(244,241,232,0.72);
          margin:20px 0 0;
          max-width:380px;
        }
        .login-page .lp-circle{
          position:absolute;
          right:-40px;
          top:-40px;
          width:220px;
          height:220px;
          border:2px dashed rgba(245,165,36,0.25);
          border-radius:50%;
          pointer-events:none;
          z-index:1;
        }
        .login-page .lp-square{
          position:absolute;
          right:40px;
          top:40px;
          width:28px;
          height:28px;
          background:var(--amber);
          border:1.5px solid var(--ink);
          transform:rotate(8deg);
          pointer-events:none;
          z-index:1;
        }

        .login-page .lp-form-panel{
          padding:64px 56px;
          display:flex;
          flex-direction:column;
          justify-content:center;
          background:var(--card);
        }
        .login-page .lp-form-eyebrow{
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.8px;
          text-transform:uppercase;
          font-weight:700;
          color:var(--gold);
          margin-bottom:28px;
        }
        .login-page .lp-error{
          background:#FFF6E0;
          border:2px solid var(--ink);
          padding:12px 14px;
          margin-bottom:18px;
          display:flex;
          gap:12px;
          align-items:flex-start;
          font-family:var(--font-display);
          font-size:14px;
          color:var(--ink);
          line-height:1.45;
          font-weight:500;
        }
        .login-page .lp-error-pip{
          flex-shrink:0;
          width:22px;
          height:22px;
          background:var(--ink);
          color:var(--amber);
          display:inline-flex;
          align-items:center;
          justify-content:center;
          font-family:var(--font-display);
          font-weight:900;
          font-size:13px;
        }
        .login-page form{display:flex;flex-direction:column;gap:18px}
        .login-page .lp-label{
          display:block;
          margin-bottom:8px;
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.8px;
          font-weight:700;
          color:var(--ink-70);
          text-transform:uppercase;
        }
        .login-page .lp-field-row{
          display:flex;
          align-items:baseline;
          justify-content:space-between;
          margin-bottom:8px;
        }
        .login-page .lp-field-row .lp-label{margin-bottom:0}
        .login-page .lp-forgot{
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.4px;
          font-weight:700;
          color:var(--gold);
          text-transform:uppercase;
          text-decoration:none;
          transition:opacity .12s ease;
        }
        .login-page .lp-forgot:hover{opacity:.55}
        .login-page .lp-input{
          width:100%;
          height:52px;
          padding:0 16px;
          font-family:var(--font-display);
          font-size:16px;
          font-weight:500;
          color:var(--ink);
          background:#FFFFFF;
          border:2px solid var(--ink);
          border-radius:0;
          outline:none;
          transition:box-shadow .15s ease, border-color .15s ease;
        }
        .login-page .lp-input:focus{
          border-color:var(--amber);
          box-shadow:0 0 0 3px rgba(245,165,36,0.25);
        }
        .login-page .lp-input::placeholder{
          color:rgba(21,18,11,0.35);
          font-weight:400;
        }
        .login-page .lp-cta{
          height:60px;
          width:100%;
          margin-top:10px;
          background:var(--amber);
          color:var(--ink);
          border:2px solid var(--ink);
          border-radius:0;
          font-family:var(--font-display);
          font-size:14px;
          font-weight:800;
          letter-spacing:1.6px;
          text-transform:uppercase;
          cursor:pointer;
          transition:transform .12s ease, filter .15s ease;
        }
        .login-page .lp-cta:hover{transform:translateY(-1px);filter:brightness(1.04)}
        .login-page .lp-cta:active{transform:translateY(0)}
        .login-page .lp-cta:disabled{
          background:#EFEADD;
          opacity:.85;
          cursor:wait;
          transform:none;
          filter:none;
        }
        .login-page .lp-members-only{
          margin-top:24px;
          padding-top:20px;
          border-top:1px dashed var(--ink-30);
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.6px;
          color:var(--gold);
          font-weight:700;
          text-transform:uppercase;
        }

        .login-page .lp-footer{
          margin-top:24px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          font-family:var(--font-mono);
          font-size:11px;
          letter-spacing:1.4px;
          color:var(--ink-70);
          font-weight:700;
          text-transform:uppercase;
          flex-wrap:wrap;
          gap:12px;
        }
        .login-page .lp-footer a{
          color:var(--ink-70);
          text-decoration:none;
          transition:opacity .12s ease;
        }
        .login-page .lp-footer a:hover{opacity:.55}
        .login-page .lp-footer-links{display:flex;gap:24px}

        @media (max-width:768px){
          .login-page .lp-topbar{padding:16px 16px}
          .login-page .lp-main{padding:16px}
          .login-page .lp-card{
            grid-template-columns:1fr;
            min-height:auto;
            box-shadow:6px 6px 0 var(--ink);
          }
          .login-page .lp-brand{
            min-height:280px;
            padding:40px 28px;
          }
          .login-page .lp-form-panel{padding:40px 28px}
          .login-page .lp-form-eyebrow{margin-bottom:22px}
        }
      `}</style>

      <div className="lp-topbar">
        <div className="lp-topbar-inner">
          <Link href="/" className="lp-wordmark">
            <span className="lp-mark">L</span>
            <span>LONGBOARD<em>AI</em></span>
          </Link>
        </div>
      </div>

      <div className="lp-main">
        <div className="lp-shell">
          <div className="lp-card">
            <div className="lp-brand">
              <div className="lp-brand-inner">
                <div className="lp-eyebrow-amber">● THE DAILY BRIEF · MEMBERS</div>
                <h1 className="lp-h1">
                  Welcome back.{" "}
                  <span className="lp-h1-italic">Let&rsquo;s play the long game.</span>
                </h1>
                <p className="lp-dek">
                  Sign in for today&rsquo;s plan, your archive, and the open-bell pulse.
                </p>
              </div>

              <div aria-hidden="true" className="lp-circle" />
              <div aria-hidden="true" className="lp-square" />
            </div>

            <div className="lp-form-panel">
              <div className="lp-form-eyebrow">● SIGN IN</div>

              {error && (
                <div className="lp-error" role="alert">
                  <span className="lp-error-pip">!</span>
                  <div>{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="li-email" className="lp-label">EMAIL</label>
                  <input
                    id="li-email"
                    className="lp-input"
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus
                    placeholder="you@somewhere.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <div className="lp-field-row">
                    <label htmlFor="li-password" className="lp-label">PASSWORD</label>
                    <Link href="/login/forgot" className="lp-forgot">FORGOT? →</Link>
                  </div>
                  <input
                    id="li-password"
                    className="lp-input"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <button type="submit" className="lp-cta" disabled={loading}>
                  {loading ? "SIGNING IN…" : "SIGN IN →"}
                </button>
              </form>

              <div className="lp-members-only">● MEMBERS ONLY</div>
            </div>
          </div>

          <div className="lp-footer">
            <div>© LONGBOARD AI 2026</div>
            <div className="lp-footer-links">
              <a href="#">TERMS</a>
              <a href="#">PRIVACY</a>
              <a href="#">SUPPORT</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
