"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function CommandSubnav() {
  const pathname = usePathname();
  const active =
    pathname.startsWith("/command/trade")
      ? "trade"
      : pathname.startsWith("/command/manage")
        ? "manage"
        : "find";

  return (
    <div className="command-subnav" aria-label="Command Center" style={{ marginTop: 14 }}>
      <Link className={`command-pill ${active === "find" ? "active" : ""}`} href="/command/find">
        Find
      </Link>
      <Link className={`command-pill ${active === "trade" ? "active" : ""}`} href="/command/trade">
        Trade
      </Link>
      <Link className={`command-pill ${active === "manage" ? "active" : ""}`} href="/command/manage">
        Manage
      </Link>
    </div>
  );
}

