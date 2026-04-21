"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Broker = "alpaca" | "tradezero";
type Status = { alpaca: { configured: boolean }; tradezero: { configured: boolean } };

/** Polls /api/auth/me/broker-status once per mount. Broker configuration
 *  changes so rarely (Settings page edit) that re-polling on an interval
 *  would just waste cycles. */
function useBrokerStatus(): Status | null {
  const [state, setState] = useState<Status | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me/broker-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.alpaca && data?.tradezero) setState(data as Status); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return state;
}

/** Returns true when the given broker is configured for the current user.
 *  Defaults to true until the status resolves so quick-order buttons aren't
 *  disabled on first paint (same rationale as useKillSwitchOrdersBlocked). */
export function useBrokerConfigured(broker: Broker): boolean {
  const [mounted, setMounted] = useState(false);
  const status = useBrokerStatus();
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || !status) return true;
  return status[broker].configured;
}

export default function BrokerNotConfiguredBanner({ broker }: { broker: Broker }) {
  const [mounted, setMounted] = useState(false);
  const status = useBrokerStatus();
  useEffect(() => { setMounted(true); }, []);

  if (!mounted || !status) return null;
  if (status[broker].configured) return null;

  const label = broker === "alpaca" ? "Alpaca" : "TradeZero";
  return (
    <div
      style={{
        background: "var(--warning-10)",
        borderTop: "1px solid var(--warning)",
        borderBottom: "1px solid var(--warning)",
        color: "var(--warning)",
        fontFamily: "var(--font-labels)",
        fontSize: 13,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <strong style={{ letterSpacing: "0.08em" }}>BROKER NOT CONFIGURED</strong>{" "}
        <span style={{ opacity: 0.85 }}>
          — Add your {label} API credentials to use this dashboard.
        </span>
      </div>
      <Link
        href="/settings/keys"
        style={{ color: "var(--warning)", textDecoration: "underline", whiteSpace: "nowrap" }}
      >
        Configure in Settings →
      </Link>
    </div>
  );
}
