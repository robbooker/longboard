"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const green = "#00ff88";
const red = "#ff5c5c";
const dim = "#5a6168";
const text = "#e6f1ec";
const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const bg = "#0a0e0c";
const border = "#1a2420";
const TZ_GOLD = "#d4af37";

const links = [
  { href: "/", label: "Research" },
  { href: "/alpaca", label: "Alpaca (Paper)" },
  { href: "/tradezero", label: "TradeZero (Live)" },
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
      padding: "10px 24px", background: bg, borderBottom: `1px solid ${border}`,
      fontFamily: font,
    }}>
      {/* Left — wordmark */}
      <a href="/" style={{
        color: green, fontSize: 13, fontWeight: 600, letterSpacing: 3,
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

          let color = dim;
          let borderColor = "transparent";
          let background = "transparent";

          if (active && isTZ) {
            color = TZ_GOLD;
            borderColor = red + "60";
            background = red + "10";
          } else if (active) {
            color = green;
            borderColor = green + "40";
            background = green + "0a";
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
      <div style={{ fontSize: 10, color: dim, letterSpacing: 0.5 }}>
        {email || ""}
      </div>
    </nav>
  );
}
