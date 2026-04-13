"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const TZ_GOLD = "#d4af37";

const links = [
  { href: "/", label: "Research" },
  { href: "/alpaca", label: "Alpaca (Paper)" },
  { href: "/tradezero", label: "TradeZero (Live)" },
  { href: "/settings", label: "Settings" },
] as const;

export default function DashboardNav() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  return (
    <nav style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 24px", background: "var(--bg)",
      borderBottom: "1px solid var(--border)",
      fontFamily: font,
    }}>
      {/* Left — wordmark */}
      <a href="/" style={{
        color: "var(--accent)", fontSize: 13, fontWeight: 600, letterSpacing: 3,
        textDecoration: "none",
      }}>
        LONGBOARD.AI
      </a>

      {/* Center — nav links */}
      <div style={{ display: "flex", gap: 6 }}>
        {links.map(({ href, label }) => {
          const active = href === "/"
            ? pathname === "/"
            : pathname.startsWith(href);
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

      {/* Right — user email */}
      <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 0.5 }}>
        {email || ""}
      </div>
    </nav>
  );
}
