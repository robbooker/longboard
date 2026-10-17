// CHAT-TIMING read side for the /dev page (company dashboard). Per day (America/Chicago),
// metric and device: sample count, median and 95th percentile over the last 30 days.
// Auth: `Authorization: Bearer <CHAT_TIMINGS_READ_TOKEN>` (server-to-server), or a signed-in
// Longboard admin. Shape: see docs in the PR / lib/chatTimings.ts.
//
// EVENT-STREAM step 3: `byStream` holds the same rows split by whether the room's event stream
// was on for the sample (`stream`: "on" | "off" | "unknown" for samples from before the tag), and
// `streamReady` says whether that split exists yet (its migration applied). `rows` is unchanged.
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function tokenMatches(req: NextRequest) {
  const configured = process.env.CHAT_TIMINGS_READ_TOKEN?.trim();
  const header = req.headers.get("authorization") ?? "";
  if (!configured || !header.toLowerCase().startsWith("bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(configured);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type DailyRow = {
  day: string;
  metric: string;
  device: string;
  stream?: string | null;
  samples: number;
  median: number | null;
  p95: number | null;
  wrong_share: number | null;
};

export async function GET(req: NextRequest) {
  if (!tokenMatches(req)) {
    if (req.headers.get("authorization")) return json({ error: "unauthorized" }, 401);
    const admin = await requireAdmin(req);
    if (!admin.ok) return json({ error: admin.error }, admin.status);
  }
  const days = Math.min(30, Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get("days") ?? 30)) || 30));
  const db = createChatAdminClient();
  if (!db) return json({ error: "timings_unavailable" }, 503);
  const [{ data, error }, split] = await Promise.all([
    db.rpc("chat_timings_daily", { p_days: days }),
    db.rpc("chat_timings_daily_by_stream", { p_days: days }),
  ]);
  if (error) {
    // Before the migration is applied the dashboard just shows "no data yet".
    if (["42883", "PGRST202", "42P01", "PGRST205"].includes(String(error.code)))
      return json({ days, timezone: "America/Chicago", ready: false, rows: [] });
    return json({ error: "timings_unavailable" }, 503);
  }
  const shape = (row: DailyRow) => ({
    day: row.day,
    metric: row.metric,
    device: row.device,
    samples: Number(row.samples),
    median: row.median === null ? null : Math.round(Number(row.median)),
    p95: row.p95 === null ? null : Math.round(Number(row.p95)),
    ...(row.metric === "wrong_landing" ? { wrongShare: row.wrong_share === null ? null : Number(row.wrong_share) } : {}),
  });
  const rows = ((data ?? []) as DailyRow[]).map(shape);
  // Before the step 3 migration (or if the split read fails) only the unsplit rows.
  const byStream = split.error
    ? []
    : ((split.data ?? []) as DailyRow[]).map((row) => ({
        ...shape(row),
        stream: row.stream === "on" || row.stream === "off" ? row.stream : "unknown",
      }));
  return json({ days, timezone: "America/Chicago", ready: true, rows, streamReady: !split.error, byStream });
}
