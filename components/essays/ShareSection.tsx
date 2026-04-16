"use client";

import { useEffect, useState } from "react";

type Props = {
  slug: string;
  title: string;
};

const TREATMENTS = ["a", "b"] as const;
const SIZES = [
  { label: "og", display: "OG 1200×630" },
  { label: "square", display: "Square 1080×1080" },
  { label: "story", display: "Story 1080×1920" },
] as const;

export default function ShareSection({ slug, title }: Props) {
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/learn/${slug}` : `/learn/${slug}`;

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.role === "admin") setIsAdmin(true); })
      .catch(() => {});
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const twitterUrl = `https://x.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  return (
    <div className="share-section">
      <div className="share-buttons">
        <button type="button" onClick={copyLink} className="share-btn">
          {copied ? "Copied!" : "Copy link"}
        </button>
        <a href={twitterUrl} target="_blank" rel="noopener noreferrer" className="share-btn">
          Share on X
        </a>
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" className="share-btn">
          Share on LinkedIn
        </a>
      </div>

      {isAdmin && (
        <details className="share-downloads">
          <summary>Download share cards</summary>
          <div className="share-downloads-grid">
            {TREATMENTS.map((t) =>
              SIZES.map((s) => (
                <a
                  key={`${t}-${s.label}`}
                  href={`/og/${slug}-${t}-${s.label}.png`}
                  download
                  className="share-download-link"
                >
                  {t.toUpperCase()} · {s.display}
                </a>
              )),
            )}
          </div>
        </details>
      )}
    </div>
  );
}
