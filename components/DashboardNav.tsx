"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import UserMenu from "@/components/UserMenu";

const font = "var(--font-labels)";
const TZ_GOLD = "#d4af37";

const authedLinks = [
  { href: "/command/find", label: "Command" },
  { href: "/workspace", label: "Workspace" },
  { href: "/alpaca", label: "Alpaca (Paper)" },
  { href: "/tradezero", label: "TradeZero (Live)" },
] as const;

// Public link — always visible, logged in or not. Sits at the end of
// the authed link cluster for logged-in users, and renders standalone
// for anon visitors who'd otherwise see no links at all.
const learnLink = { href: "/learn", label: "Learn" } as const;

type Me = {
  id: string;
  email: string;
  role: "user" | "admin";
  boardroom_cohorts?: string[];     // e.g. ["cohort-1"]
};

export default function DashboardNav() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [uiMode, setUiMode] = useState<"classic" | "modern">("modern");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.id) setMe(data as Me); })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    setThemeMode(t === "dark" ? "dark" : "light");
    const u = document.documentElement.getAttribute("data-ui");
    setUiMode(u === "classic" ? "classic" : "modern");

    const obs = new MutationObserver(() => {
      const t2 = document.documentElement.getAttribute("data-theme");
      setThemeMode(t2 === "dark" ? "dark" : "light");
      const u2 = document.documentElement.getAttribute("data-ui");
      setUiMode(u2 === "classic" ? "classic" : "modern");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-ui"] });
    return () => obs.disconnect();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const loggedIn = !!me;
  const logoHref = loggedIn ? "/workspace" : "/";

  const links = loggedIn ? [...authedLinks, learnLink] : [learnLink];

  // Phase 3N: the bubbles home page (`/`) ships its own internal sticky
  // nav. Phase 3O extends the same suppression to `/thanks`, which uses
  // the same DNA. Phase 4-pre: `/command2` ships its own dark top nav
  // baked into the v2 shell. Login surfaces (`/login`, `/login/forgot`)
  // ship a minimal editorial top bar with just the wordmark — the
  // dashboard nav's auth-required links are footguns when shown to a
  // logged-out user. Lab surfaces (`/lab/*`) render their own thin
  // LabHeader from app/lab/layout.tsx, so suppress the dashboard nav
  // there too. /learn surfaces (the Daily index and essay detail pages)
  // now ship the same dark top nav as /command2 via app/learn/layout.tsx,
  // so suppress here as well. Placed after hooks so the call order
  // stays stable across pathname changes.
  if (pathname === "/" || pathname === "/thanks" || pathname === "/command2" || pathname === "/admin/morning-email" || pathname === "/login" || pathname === "/login/forgot" || pathname.startsWith("/lab") || pathname.startsWith("/learn")) return null;

  return (
    <nav style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 24px", background: "var(--bg)",
      borderBottom: "1px solid var(--border)",
      fontFamily: font,
    }}>
      {/* Left — wordmark (home = marketing if anon, workspace if authed) */}
      <a href={logoHref} style={{
        color: "var(--accent)", fontSize: 13, fontWeight: 600, letterSpacing: 3,
        textDecoration: "none",
      }}>
        LONGBOARD.AI
      </a>

      {/* Center — nav links, logged-in only */}
      <div style={{ display: "flex", gap: 6 }}>
        {loggedIn && links.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          const isTZ = href === "/tradezero";

          let color = "var(--text-secondary)";
          let borderColor = "transparent";
          let background = "transparent";

          if (active && isTZ) {
            color = TZ_GOLD;
            borderColor = "var(--danger-40)";
            background = "var(--danger-15)";
          } else if (active) {
            color = "var(--accent)";
            borderColor = "var(--accent-20)";
            background = "var(--accent-10)";
          }

          return (
            <a key={href} href={href} style={{
              fontSize: 11, padding: "4px 12px",
              color, border: `1px solid ${borderColor}`, background,
              borderRadius: 3, textDecoration: "none", letterSpacing: 1,
              fontWeight: active ? 600 : 400,
              transition: "all 150ms",
            }}>
              {label}
            </a>
          );
        })}
      </div>

      {/* Right — UserMenu (authed) or Sign In (anon). Nothing until auth resolves. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => {
                const next = "light";
                setThemeMode(next);
                try { localStorage.setItem("longboard-theme", next); } catch {}
                document.documentElement.setAttribute("data-theme", next);
              }}
              style={{
                fontSize: 10,
                padding: "4px 10px",
                border: "none",
                background: themeMode === "light" ? "var(--accent-10)" : "transparent",
                color: themeMode === "light" ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
                letterSpacing: 0.8,
                fontFamily: font,
              }}
              title="Toggle light/dark"
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => {
                const next = "dark";
                setThemeMode(next);
                try { localStorage.setItem("longboard-theme", next); } catch {}
                document.documentElement.setAttribute("data-theme", next);
              }}
              style={{
                fontSize: 10,
                padding: "4px 10px",
                border: "none",
                background: themeMode === "dark" ? "var(--accent-10)" : "transparent",
                color: themeMode === "dark" ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
                letterSpacing: 0.8,
                fontFamily: font,
              }}
            >
              Dark
            </button>
          </div>

          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => {
                const next = "classic";
                setUiMode(next);
                try { localStorage.setItem("longboard-ui", next); } catch {}
                document.documentElement.setAttribute("data-ui", next);
              }}
              style={{
                fontSize: 10,
                padding: "4px 10px",
                border: "none",
                background: uiMode === "classic" ? "var(--accent-10)" : "transparent",
                color: uiMode === "classic" ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
                letterSpacing: 0.8,
                fontFamily: font,
              }}
              title="Toggle classic/modern"
            >
              Classic
            </button>
            <button
              type="button"
              onClick={() => {
                const next = "modern";
                setUiMode(next);
                try { localStorage.setItem("longboard-ui", next); } catch {}
                document.documentElement.setAttribute("data-ui", next);
              }}
              style={{
                fontSize: 10,
                padding: "4px 10px",
                border: "none",
                background: uiMode === "modern" ? "var(--accent-10)" : "transparent",
                color: uiMode === "modern" ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
                letterSpacing: 0.8,
                fontFamily: font,
              }}
            >
              Modern
            </button>
          </div>
        </div>
        {authChecked && (
          loggedIn ? (
            <UserMenu
              email={me!.email}
              isAdmin={me!.role === "admin"}
              boardroomCohorts={me!.boardroom_cohorts ?? []}
              onLogout={handleLogout}
            />
          ) : (
            <a
              href="/login"
              style={{
                fontSize: 11, padding: "4px 12px",
                color: "var(--text-secondary)", border: "1px solid var(--border)",
                borderRadius: 3, textDecoration: "none", letterSpacing: 1,
                transition: "all 150ms",
              }}
            >
              Sign In
            </a>
          )
        )}
      </div>
    </nav>
  );
}
