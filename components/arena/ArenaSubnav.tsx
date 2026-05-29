"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/arena/feed", label: "Feed", key: "feed" },
  { href: "/arena/portfolios", label: "Portfolios", key: "portfolios" },
  { href: "/arena/leaderboard", label: "Leaderboard", key: "leaderboard" },
] as const;

export default function ArenaSubnav() {
  const pathname = usePathname();
  const active = pathname.startsWith("/arena/agents")
    ? null
    : TABS.find((t) => pathname.startsWith(t.href))?.key ?? "feed";

  return (
    <nav className="arena-subnav" aria-label="Arena">
      {TABS.map(({ href, label, key }) => (
        <Link
          key={key}
          className={`arena-pill ${active === key ? "active" : ""}`}
          href={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
