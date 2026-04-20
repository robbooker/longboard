import "../strategies.css";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient as createSsrClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { MDXRemote } from "next-mdx-remote/rsc";

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

type StratRun = {
  id: string;
  run_type: string;
  ran_at: string;
  status: "ok" | "error" | "skipped" | "running";
  error: string | null;
  writeup_md: string | null;
  output: unknown;
};

type StratPosition = {
  id: string;
  ticker: string;
  side: string;
  qty: number;
  entry_price: number;
  stop_price: number;
  opened_at: string;
  thesis: string;
  pnl: number | null;
  closed_at: string | null;
};

type StratTrade = {
  id: string;
  ticker: string;
  side: string;
  qty: number;
  order_type: string;
  status: string;
  submitted_at: string | null;
  filled_at: string | null;
  fill_price: number | null;
};

async function loadSpec(specPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), specPath), "utf8");
  } catch {
    return null;
  }
}

function fmtUSD(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // ── Auth gate ──
  const ssr = await createSsrClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await ssr
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") redirect("/");

  // ── Data ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return <ErrorState message="server_misconfigured" />;
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: strategyRow, error: stratErr } = await admin
    .from("strategies")
    .select("id,name,status,mandate,spec_path,starting_capital,started_at")
    .eq("id", slug)
    .maybeSingle();
  if (stratErr) return <ErrorState message={stratErr.message} />;
  if (!strategyRow) notFound();

  const strategy = strategyRow as Strategy;

  if (strategy.status !== "live") {
    // Planned or paused — simple informational surface.
    return <PlannedDetail strategy={strategy} />;
  }

  const [
    { data: latestRunRow, error: runErr },
    { data: openPositionRows, error: openErr },
    { data: recentTradeRows, error: tradesErr },
    { data: closedPositionRows, error: closedErr },
  ] = await Promise.all([
    admin.from("strat_runs")
      .select("id,run_type,ran_at,status,error,writeup_md,output")
      .eq("strategy_id", strategy.id)
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("strat_positions")
      .select("id,ticker,side,qty,entry_price,stop_price,opened_at,thesis,pnl,closed_at")
      .eq("strategy_id", strategy.id)
      .is("closed_at", null)
      .order("opened_at", { ascending: false }),
    admin.from("strat_trades")
      .select("id,ticker,side,qty,order_type,status,submitted_at,filled_at,fill_price")
      .eq("strategy_id", strategy.id)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(25),
    admin.from("strat_positions")
      .select("pnl")
      .eq("strategy_id", strategy.id)
      .not("closed_at", "is", null)
      .not("pnl", "is", null),
  ]);

  const firstErr = runErr ?? openErr ?? tradesErr ?? closedErr;
  if (firstErr) return <ErrorState message={firstErr.message} />;

  const latestRun = latestRunRow as StratRun | null;
  const openPositions = (openPositionRows ?? []) as StratPosition[];
  const recentTrades = (recentTradeRows ?? []) as StratTrade[];
  const closedPnl = (closedPositionRows ?? []).reduce(
    (sum, r) => sum + Number((r as { pnl: number | null }).pnl ?? 0),
    0,
  );
  const starting = Number(strategy.starting_capital ?? 0);
  const equity = starting + closedPnl;

  const specBody = await loadSpec(strategy.spec_path);

  return (
    <div className="strategies-page">
      <div className="wrap">
        <Link href="/strategies" className="back-link">
          ← All strategies
        </Link>

        <header className="detail-head">
          <h1 className="detail-h1">{strategy.name}</h1>
          <p className="detail-mandate">{strategy.mandate}</p>

          <div className="detail-status-strip">
            <Tile label="Status" value={strategy.status.toUpperCase()} />
            <Tile label="Capital" value={fmtUSD(starting)} />
            <Tile label="Equity" value={fmtUSD(equity)} />
            <Tile label="Open positions" value={`${openPositions.length} / 1`} />
            <Tile
              label="Last run"
              value={latestRun ? fmtTime(latestRun.ran_at) : "never"}
            />
          </div>
        </header>

        {/* ── Today's writeup ── */}
        <section className="detail-section" id="writeup">
          <h2 className="detail-section-head">Today&apos;s writeup</h2>
          {latestRun ? (
            <WriteupBlock run={latestRun} />
          ) : (
            <div className="placeholder-box">
              No runs yet. First morning run lands once the scheduler is wired
              (Commit 5). When a run completes, its writeup appears here.
            </div>
          )}
        </section>

        {/* ── Open positions ── */}
        <section className="detail-section">
          <h2 className="detail-section-head">
            Open positions
            <span style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 0, textTransform: "none", fontWeight: 400, marginLeft: 8 }}>
              {openPositions.length}
            </span>
          </h2>
          {openPositions.length === 0 ? (
            <div className="placeholder-box">No open positions.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Opened</th>
                    <th>Thesis</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.ticker}</strong></td>
                      <td className="muted">{p.side}</td>
                      <td>{fmtQty(p.qty)}</td>
                      <td>{fmtUSD(p.entry_price)}</td>
                      <td>{fmtUSD(p.stop_price)}</td>
                      <td className="muted">{fmtTime(p.opened_at)}</td>
                      <td className="muted" style={{ maxWidth: 320, whiteSpace: "normal" }}>
                        {p.thesis}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Recent trades ── */}
        <section className="detail-section">
          <h2 className="detail-section-head">
            Recent trades
            <span style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 0, textTransform: "none", fontWeight: 400, marginLeft: 8 }}>
              last {recentTrades.length}
            </span>
          </h2>
          {recentTrades.length === 0 ? (
            <div className="placeholder-box">No trades yet.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Filled</th>
                    <th>Fill $</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.ticker}</strong></td>
                      <td className="muted">{t.side}</td>
                      <td>{fmtQty(t.qty)}</td>
                      <td className="muted">{t.order_type}</td>
                      <td className="muted">{t.status}</td>
                      <td className="muted">{fmtTime(t.submitted_at)}</td>
                      <td className="muted">{fmtTime(t.filled_at)}</td>
                      <td>{t.fill_price !== null ? fmtUSD(Number(t.fill_price)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Equity curve placeholder ── */}
        <section className="detail-section">
          <h2 className="detail-section-head">Equity curve</h2>
          <div className="placeholder-box">
            Equity curve lands in Phase 2 once daily close snapshots start
            accumulating. SPY comparison line overlays on the same axis.
          </div>
        </section>

        {/* ── How it works inline (reference) ── */}
        {specBody && (
          <section className="detail-section">
            <h2 className="detail-section-head">How it works</h2>
            <div className="writeup-box">
              <MDXRemote source={specBody} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function WriteupBlock({ run }: { run: StratRun }) {
  const meta = `${run.run_type} · ${fmtTime(run.ran_at)} · ${run.status}`;
  if (run.status === "error") {
    return (
      <>
        <p className="detail-meta-strip">{meta}</p>
        <div className="placeholder-box" style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
          Error: {run.error ?? "unknown"}
        </div>
      </>
    );
  }
  return (
    <>
      <p className="detail-meta-strip">{meta}</p>
      {run.writeup_md ? (
        <div className="writeup-box">
          <MDXRemote source={run.writeup_md} />
        </div>
      ) : (
        <div className="placeholder-box">
          Run completed without a writeup (decision was to skip).
        </div>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="detail-tile-label">{label}</p>
      <p className="detail-tile-value">{value}</p>
    </div>
  );
}

function PlannedDetail({ strategy }: { strategy: Strategy }) {
  return (
    <div className="strategies-page">
      <div className="wrap">
        <Link href="/strategies" className="back-link">
          ← All strategies
        </Link>

        <header className="detail-head">
          <h1 className="detail-h1">{strategy.name}</h1>
          <p className="detail-mandate">{strategy.mandate}</p>
        </header>

        <div className="planned-detail-box">
          <span className="planned-detail-badge">Planned</span>
          <p style={{ marginTop: 0, marginBottom: 10, color: "var(--text-primary)" }}>
            This strategy is scoped but not yet live. It is not running, not
            funded, and not scheduled.
          </p>
          <PlannedSpec specPath={strategy.spec_path} />
        </div>
      </div>
    </div>
  );
}

async function PlannedSpec({ specPath }: { specPath: string }) {
  const body = await loadSpec(specPath);
  if (!body) return null;
  return (
    <div className="writeup-box" style={{ marginTop: 16 }}>
      <MDXRemote source={body} />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="strategies-page">
      <div className="wrap">
        <div className="placeholder-box" style={{ color: "var(--danger)" }}>
          Error loading strategy: {message}
        </div>
      </div>
    </div>
  );
}
