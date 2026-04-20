import "./strategies.css";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient as createSsrClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { MDXRemote } from "next-mdx-remote/rsc";
import HowItWorksModal from "@/components/strategies/HowItWorksModal";

export const dynamic = "force-dynamic";

type Strategy = {
  id: string;
  name: string;
  status: "live" | "planned" | "paused";
  mandate: string;
  spec_path: string;
  starting_capital: number | null;
  started_at: string | null;
};

type LiveRollup = {
  strategy: Strategy;
  equity: number;
  pnl: number;
  pnlPct: number;
  openPositions: number;
  lastRanAt: string | null;
  specBody: string | null;       // null if the file is missing
};

/** Reads the canonical spec markdown for a strategy. Returns null if
 *  the file doesn't exist — the modal falls back to the mandate alone. */
async function loadSpec(specPath: string): Promise<string | null> {
  try {
    const full = path.join(process.cwd(), specPath);
    return await readFile(full, "utf8");
  } catch {
    return null;
  }
}

/** Combined-equity rollup for a single live strategy. Phase 1 always
 *  reports $starting_capital since no trades have closed yet — the math
 *  is wired here so it's correct from the moment positions start
 *  closing. Unrealized P&L on open positions is ignored this phase
 *  (Polygon snapshot call per open position is Phase 2's equity-curve
 *  work). */
function rollupLive(
  strategy: Strategy,
  closedPnl: number,
  openPositionsCount: number,
  lastRanAt: string | null,
  specBody: string | null,
): LiveRollup {
  const starting = Number(strategy.starting_capital ?? 0);
  const equity = starting + closedPnl;
  const pnl = equity - starting;
  const pnlPct = starting > 0 ? (pnl / starting) * 100 : 0;
  return {
    strategy,
    equity,
    pnl,
    pnlPct,
    openPositions: openPositionsCount,
    lastRanAt,
    specBody,
  };
}

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Relative "3 min ago" style formatter, bounded to 30d then falls back
 *  to a short date. Used on the aggregate strip + live card meta. */
function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Planned-card "needs" hint. These strings should eventually live in
 *  the spec doc frontmatter — hardcoded for Phase 1 since only two
 *  strategies are planned and both are parked on well-understood gaps. */
const PLANNED_NEEDS: Record<string, string> = {
  "black-swan": "needs options + VIX products",
  "covered-caller": "needs index options chain",
};

export default async function StrategiesHomePage() {
  // ── Auth gate — admin only, matches /admin pattern ──
  const ssr = await createSsrClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await ssr
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") redirect("/");

  // ── Data — service role for the rest so we're not fighting RLS ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return <ErrorState message="server_misconfigured" />;
  }
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    { data: strategies, error: stratErr },
    { data: closedPositions, error: posErr },
    { data: openPositions, error: openErr },
    { data: lastRuns, error: runsErr },
  ] = await Promise.all([
    admin.from("strategies")
      .select("id,name,status,mandate,spec_path,starting_capital,started_at")
      .order("status")
      .order("id"),
    admin.from("strat_positions")
      .select("strategy_id,pnl")
      .not("closed_at", "is", null)
      .not("pnl", "is", null),
    admin.from("strat_positions")
      .select("strategy_id")
      .is("closed_at", null),
    admin.from("strat_runs")
      .select("strategy_id,ran_at")
      .order("ran_at", { ascending: false }),
  ]);

  const firstError = stratErr ?? posErr ?? openErr ?? runsErr;
  if (firstError) return <ErrorState message={firstError.message} />;

  const rows = (strategies ?? []) as Strategy[];
  const live = rows.filter((s) => s.status === "live");
  const planned = rows.filter((s) => s.status === "planned");

  // Aggregate maps keyed by strategy_id.
  const closedPnlByStrategy = new Map<string, number>();
  for (const p of closedPositions ?? []) {
    const id = (p as { strategy_id: string }).strategy_id;
    const pnl = Number((p as { pnl: number | null }).pnl ?? 0);
    closedPnlByStrategy.set(id, (closedPnlByStrategy.get(id) ?? 0) + pnl);
  }

  const openCountByStrategy = new Map<string, number>();
  for (const p of openPositions ?? []) {
    const id = (p as { strategy_id: string }).strategy_id;
    openCountByStrategy.set(id, (openCountByStrategy.get(id) ?? 0) + 1);
  }

  const lastRunByStrategy = new Map<string, string>();
  for (const r of lastRuns ?? []) {
    const id = (r as { strategy_id: string }).strategy_id;
    if (!lastRunByStrategy.has(id)) {
      lastRunByStrategy.set(id, (r as { ran_at: string }).ran_at);
    }
  }

  const liveRollups: LiveRollup[] = await Promise.all(
    live.map(async (s) =>
      rollupLive(
        s,
        closedPnlByStrategy.get(s.id) ?? 0,
        openCountByStrategy.get(s.id) ?? 0,
        lastRunByStrategy.get(s.id) ?? null,
        await loadSpec(s.spec_path),
      ),
    ),
  );

  // ── Aggregate strip values ──
  const liveCount = live.length;
  const combinedEquity = liveRollups.reduce((sum, r) => sum + r.equity, 0);
  const combinedPnl = liveRollups.reduce((sum, r) => sum + r.pnl, 0);
  const combinedStarting = liveRollups.reduce(
    (sum, r) => sum + Number(r.strategy.starting_capital ?? 0),
    0,
  );
  const combinedPnlPct =
    combinedStarting > 0 ? (combinedPnl / combinedStarting) * 100 : 0;
  const lastRunAgo = fmtAgo(
    liveRollups
      .map((r) => r.lastRanAt)
      .filter((x): x is string => x !== null)
      .sort()
      .at(-1) ?? null,
  );

  return (
    <div className="strategies-page">
      <div className="wrap">
        {/* ── Header ── */}
        <header className="head">
          <div>
            <p className="head-title">Longboard</p>
            <h1 className="head-h1">Strategies</h1>
          </div>
          <span className="head-tag">Paper · Rob only</span>
        </header>

        {/* ── Aggregate strip ── */}
        <div className="agg-strip">
          <AggCard label="Strategies live" value={String(liveCount)} />
          <AggCard label="Combined equity" value={fmtUSD(combinedEquity)} />
          <AggCard
            label="Combined P&L"
            value={fmtUSD(combinedPnl)}
            sub={fmtPct(combinedPnlPct)}
          />
          <AggCard label="Last run" value={lastRunAgo} />
        </div>

        {/* ── Live ── */}
        <div className="section-head">
          <h2 className="section-title">Live</h2>
          <span className="section-count">{live.length}</span>
        </div>
        <div className="live-stack">
          {liveRollups.map((r) => (
            <LiveCard key={r.strategy.id} rollup={r} />
          ))}
          {liveRollups.length === 0 && (
            <div className="placeholder-box">No live strategies yet.</div>
          )}
        </div>

        {/* ── Planned ── */}
        {planned.length > 0 && (
          <>
            <div className="section-head">
              <h2 className="section-title">Planned</h2>
              <span className="section-count">{planned.length}</span>
            </div>
            <div className="planned-grid">
              {planned.map((s) => (
                <Link
                  key={s.id}
                  href={`/strategies/${s.id}`}
                  className="planned-card"
                >
                  <h3 className="planned-name">{s.name}</h3>
                  <p className="planned-mandate">{s.mandate}</p>
                  <p className="planned-needs">
                    {PLANNED_NEEDS[s.id] ?? "planned"}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AggCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="agg-card">
      <p className="agg-label">{label}</p>
      <p className="agg-value">{value}</p>
      {sub && <p className="agg-sub">{sub}</p>}
    </div>
  );
}

function LiveCard({ rollup }: { rollup: LiveRollup }) {
  const { strategy, equity, pnl, pnlPct, openPositions, lastRanAt, specBody } = rollup;
  const pnlClass = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "muted";

  return (
    <article className="live-card">
      <div>
        <h3 className="live-card-name">{strategy.name}</h3>
        <p className="live-card-mandate">{strategy.mandate}</p>

        <div className="live-metrics">
          <Metric label="Equity" value={fmtUSD(equity)} />
          <Metric label="P&L" value={fmtUSD(pnl)} className={pnlClass} sub={fmtPct(pnlPct)} />
          <Metric label="vs SPY" value="—" className="muted" />
          <Metric label="Positions" value={`${openPositions} / 1`} />
          <Metric label="Last run" value={fmtAgo(lastRanAt)} className="muted" />
        </div>

        <div className="sparkline-placeholder">Equity curve — Phase 2</div>
      </div>

      <div className="live-actions">
        <Link
          href={`/strategies/${strategy.id}`}
          className="action-btn primary"
        >
          Open strategy
        </Link>
        <HowItWorksModal
          strategyName={strategy.name}
          buttonClass="action-btn"
        >
          {specBody ? (
            <MDXRemote source={specBody} />
          ) : (
            <p>
              <strong>Mandate.</strong> {strategy.mandate}
            </p>
          )}
        </HowItWorksModal>
        <Link
          href={`/strategies/${strategy.id}#writeup`}
          className="action-btn"
        >
          Today&apos;s writeup
        </Link>
      </div>
    </article>
  );
}

function Metric({
  label, value, sub, className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div>
      <p className="metric-label">{label}</p>
      <p className={`metric-value ${className ?? ""}`}>{value}</p>
      {sub && <p className="metric-label" style={{ marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="strategies-page">
      <div className="wrap">
        <div className="placeholder-box" style={{ color: "var(--danger)" }}>
          Error loading strategies: {message}
        </div>
      </div>
    </div>
  );
}
