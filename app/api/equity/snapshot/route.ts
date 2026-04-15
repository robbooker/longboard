import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { captureSnapshot, listConfiguredUserIds, type SnapshotResult } from "@/lib/equitySnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Per-user brokerage API round-trips dominate runtime. For 1 user × 2
 *  brokers the job finishes in <5s. Headroom for future user growth. */
export const maxDuration = 120;

type RunResult = {
  trigger: "cron" | "manual";
  triggeredBy?: string;
  usersProcessed: number;
  results: Array<{ userId: string; broker: "alpaca" | "tradezero"; ok: boolean; detail: string }>;
  durationMs: number;
};

async function runBatch(): Promise<RunResult> {
  const startedAt = Date.now();
  const userIds = await listConfiguredUserIds();

  // Parallel across (user, broker) pairs. Each pair is independent and the
  // upsert key includes user_id + broker so there's no write contention.
  const pairs: Array<{ userId: string; broker: "alpaca" | "tradezero" }> = [];
  for (const u of userIds) {
    pairs.push({ userId: u, broker: "alpaca" });
    pairs.push({ userId: u, broker: "tradezero" });
  }

  const settled = await Promise.allSettled(pairs.map((p) => captureSnapshot(p.userId, p.broker)));

  const results = settled.map((r, i) => {
    const pair = pairs[i];
    if (r.status === "fulfilled") {
      const v = r.value as SnapshotResult;
      if (v.ok) return { userId: pair.userId, broker: pair.broker, ok: true, detail: `equity=${v.equity.toFixed(2)} positions=${v.positions_count}` };
      return { userId: pair.userId, broker: pair.broker, ok: false, detail: v.reason };
    }
    return { userId: pair.userId, broker: pair.broker, ok: false, detail: r.reason instanceof Error ? r.reason.message : "failed" };
  });

  return {
    trigger: "cron",
    usersProcessed: userIds.length,
    results,
    durationMs: Date.now() - startedAt,
  };
}

/** GET — Vercel Cron invocation. Bearer-secret auth, same shape as the
 *  run-daily research cron. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await runBatch();
    return NextResponse.json({ ...result, trigger: "cron" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "batch_failed", message: msg }, { status: 500 });
  }
}

/** POST — manual admin trigger. Useful for the Commit-5 initial backfill
 *  and for ad-hoc "capture now" runs from a future admin UI button. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await runBatch();
    return NextResponse.json({ ...result, trigger: "manual", triggeredBy: auth.user.email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "batch_failed", message: msg }, { status: 500 });
  }
}
