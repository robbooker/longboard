"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const font = "var(--font-labels)";

type Theme = "light" | "dark" | "statement";

const THEMES: readonly Theme[] = ["light", "dark", "statement"];

/** Dropdown that lives on the right side of DashboardNav for signed-in
 *  users. Collects email display, theme picker (light / dark /
 *  statement), Settings link, and logout into one panel so the top bar
 *  stays compact. Theme state is self-contained — reads and writes
 *  localStorage["longboard-theme"] and pokes <html data-theme>,
 *  mirroring the picker in /settings. */
export default function UserMenu({
  email,
  isAdmin = false,
  boardroomCohorts = [],
  onLogout,
}: {
  email: string;
  isAdmin?: boolean;
  /** Cohort suffixes (e.g. ["cohort-1"]) the user holds boardroom-cohort-* tags for.
   *  One dropdown entry rendered per cohort; empty array hides the section entirely. */
  boardroomCohorts?: string[];
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr && (THEMES as readonly string[]).includes(attr)) setTheme(attr as Theme);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyTheme(next: Theme) {
    setTheme(next);
    try { localStorage.setItem("longboard-theme", next); } catch {}
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", fontFamily: font }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent",
          border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
          color: open ? "var(--accent)" : "var(--text-secondary)",
          padding: "4px 12px", borderRadius: 3,
          fontFamily: font, fontSize: 11, letterSpacing: 0.5,
          cursor: "pointer", transition: "all 150ms",
        }}
      >
        <span>{email}</span>
        <span style={{ fontSize: 9, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 1000,
            minWidth: 240, background: "var(--surface)",
            border: "1px solid var(--border)", borderRadius: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            padding: "6px 0",
          }}
        >
          {/* Email — display only */}
          <div style={{
            padding: "8px 14px", fontSize: 11, color: "var(--text-secondary)",
            letterSpacing: 0.5, wordBreak: "break-all",
          }}>
            {email}
          </div>

          <Divider />

          {/* Theme picker */}
          <div style={{
            padding: "8px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <span style={{ fontSize: 11, color: "var(--text-primary)", letterSpacing: 0.5 }}>
              Theme
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <ThemeOption label="Light" active={theme === "light"} onClick={() => applyTheme("light")} />
              <ThemeOption label="Dark" active={theme === "dark"} onClick={() => applyTheme("dark")} />
              <ThemeOption label="Statement" active={theme === "statement"} onClick={() => applyTheme("statement")} />
            </div>
          </div>

          <Divider />

          {/* Boardroom links — one per cohort the user holds. v1 only
           *  has cohort-1 in production; multi-cohort users would see
           *  "Boardroom 1", "Boardroom 2", etc. listed above Settings.
           *  All entries link to /boardroom; the page itself currently
           *  scopes content to the first cohort the user holds — proper
           *  per-cohort routing lands when cohort-2 actually launches. */}
          {boardroomCohorts.length > 0 && (
            <>
              {boardroomCohorts.map((cohort) => {
                const number = cohort.replace(/^cohort-/, "") || cohort;
                return (
                  <Link
                    key={cohort}
                    href="/boardroom"
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    style={{
                      display: "block", padding: "8px 14px", fontSize: 12,
                      color: "var(--accent)", textDecoration: "none",
                      letterSpacing: 0.5, transition: "background 150ms",
                      fontWeight: 500,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-10)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    Boardroom {number}
                  </Link>
                );
              })}
              <Divider />
            </>
          )}

          {/* Admin */}
          {isAdmin && (
            <>
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  display: "block", padding: "8px 14px", fontSize: 12,
                  color: "var(--accent)", textDecoration: "none",
                  letterSpacing: 0.5, transition: "background 150ms",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-10)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                Admin
              </Link>
              <Link
                href="/admin/invites"
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  display: "block", padding: "8px 14px", fontSize: 12,
                  color: "var(--accent)", textDecoration: "none",
                  letterSpacing: 0.5, transition: "background 150ms",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-10)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                Member Invites
              </Link>
              <Divider />
            </>
          )}

          {/* Longing report */}
          <Link
            href="/scanner/this-week-in-longing"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{
              display: "block", padding: "8px 14px", fontSize: 12,
              color: "var(--text-primary)", textDecoration: "none",
              letterSpacing: 0.5, transition: "background 150ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-10)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            Longing Report
          </Link>

          {/* Settings */}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{
              display: "block", padding: "8px 14px", fontSize: 12,
              color: "var(--text-primary)", textDecoration: "none",
              letterSpacing: 0.5, transition: "background 150ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-10)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            Settings
          </Link>

          {/* Logout */}
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", fontSize: 12,
              background: "transparent", border: "none",
              color: "var(--danger)", fontFamily: font, letterSpacing: 0.5,
              cursor: "pointer", transition: "background 150ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--danger-15)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />;
}

function ThemeOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--bg)" : "var(--text-secondary)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        padding: "3px 10px", borderRadius: 3,
        fontFamily: font, fontSize: 10, letterSpacing: 0.8,
        cursor: active ? "default" : "pointer", transition: "all 150ms",
      }}
    >
      {label}
    </button>
  );
}
