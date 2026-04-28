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

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.id) setMe(data as Me); })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const loggedIn = !!me;
  const logoHref = loggedIn ? "/workspace" : "/";

  const links = loggedIn
    ? me?.role === "admin"
      ? [...authedLinks, learnLink, { href: "/admin", label: "Admin" } as const]
      : [...authedLinks, learnLink]
    : [learnLink];

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
        {authChecked && (
          loggedIn ? (
            <UserMenu
              email={me!.email}
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
