import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import { DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS } from "@/lib/scanners/monthlyPivots";
import { resetRvolScannerCachesForTests, scanRvolBuySignalsForResolutions } from "@/lib/scanners/rvolScanner";
import { setRvolSharedCacheForTests } from "@/lib/scanners/rvolSharedCache";
import { GET as currentAlertsGET } from "@/app/api/cron/rvol-alerts/route";
import { GET as currentScannerGET } from "@/app/api/command2/rvol-scanner/route";
import { GET as legacyAlertsGET } from "./legacy/rvolAlertsRouteLegacy";
import { GET as legacyScannerGET } from "./legacy/rvolScannerRouteLegacy";
import { scanRvolBuySignals as legacyScan } from "./legacy/rvolScannerLegacy";
import { fakePolygonFetch, loadMarketFixture } from "./helpers/fakeMarket";
import { FakeDb } from "./helpers/fakeSupabase";

// HEALTH-2026-10-17-3: the alert cron's scan was made lighter (shared snapshot, cached
// reference/history lookups, faster clock maths) and the pages now read a shared copy.
// These tests replay a recorded trading day through the old code (frozen in ./legacy) and
// the new code, and require the same alert decisions: same dispatch rows, same pushes to
// the same people, same Slack posts, same diagnostics, and the same scanner rows.
// No real network, push or Slack call is made: everything below is a fake.

const fakes = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  pushes: [] as unknown[],
  slacks: [] as unknown[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fakes.db.client(),
}));
vi.mock("@/lib/notifications/oneSignal", () => ({
  sendOneSignalPush: async (input: unknown) => {
    fakes.pushes.push(input);
    return { ok: true, id: `push-${fakes.pushes.length}`, warnings: null };
  },
}));
vi.mock("@/lib/notifications/slackRvol", () => ({
  isRvolSlackConfigured: () => true,
  sendRvolSlackAlert: async (input: unknown) => {
    fakes.slacks.push(input);
    return { ok: true };
  },
}));

const fixture = loadMarketFixture();
const PUSH_USERS = ["user-a", "user-b", "user-c"];

function et(hour: number, minute: number, second = 20) {
  return nyClockToUtcMs(2026, 10, 16, hour, minute) + second * 1000;
}

// Cron ticks (every 5 min on the real schedule) around the recorded day's signals, plus
// quiet ticks between them. 08:30 is left out on purpose so the 08:28 signal is first seen
// late and must be marked "skipped" (stale) by both versions.
const CRON_TICKS = [
  "08:00", "08:25", "08:35", "08:45",
  "11:15", "11:20",
  "12:30", "12:35",
  "13:40", "13:45",
  "14:30", "14:55", "15:00",
  "15:55", "16:00", "16:05",
].map((label) => {
  const [hour, minute] = label.split(":").map(Number);
  return et(hour, minute);
});

let clock = 0;

function freshDb() {
  const db = new FakeDb();
  for (const userId of PUSH_USERS) {
    db.rows("rvol_alert_preferences").push({ user_id: userId, browser_push_enabled: true });
  }
  db.rows("rvol_alert_preferences").push({ user_id: "user-off", browser_push_enabled: false });
  // Cached monthly pivots for every recorded ticker (so no daily-bar fetches are needed).
  Object.keys(fixture.references).forEach((ticker, index) => {
    db.rows("rvol_monthly_pivot_cache").push({
      et_date: fixture.etDate,
      ticker,
      lookback_months: DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS,
      pivots: [1.5, 3 + (index % 7), 12 + index].map((price) => ({
        price,
        sourceMonth: "2026-01",
        sourceMonthLabel: "Jan 2026",
        activeMonth: "2026-02",
        activeMonthLabel: "Feb 2026",
        activeFromDate: "2026-02-01",
        lastCheckedDate: fixture.etDate,
      })),
      computed_at: "2026-10-16T08:00:00.000Z",
      updated_at: "2026-10-16T08:00:00.000Z",
    });
  });
  return db;
}

function newSharedCache() {
  const store = new Map<string, unknown>();
  setRvolSharedCacheForTests({
    get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : undefined),
    set: async (key, value) => {
      store.set(key, structuredClone(value));
    },
  });
  return store;
}

async function runCronDay(GET: (req: NextRequest) => Promise<Response>) {
  fakes.db = freshDb();
  fakes.pushes = [];
  fakes.slacks = [];
  const responses: unknown[] = [];
  for (const tick of CRON_TICKS) {
    clock = tick;
    vi.setSystemTime(tick);
    const res = await GET(
      new NextRequest("https://longboard.test/api/cron/rvol-alerts", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    responses.push({ status: res.status, body: await res.json() });
  }
  return {
    dispatches: fakes.db.rows("rvol_alert_dispatches"),
    diagnostics: fakes.db.rows("rvol_scan_diagnostics"),
    pushes: fakes.pushes,
    slacks: fakes.slacks,
    responses,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const polygon = fakePolygonFetch(fixture, () => clock);
  vi.stubGlobal("fetch", polygon.fetchImpl);
  vi.stubEnv("POLYGON_API_KEY", "test-polygon-key");
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fake.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://longboard.test");
  vi.stubEnv("RVOL_ALERT_MAX_AGE_MINUTES", "");
  resetRvolScannerCachesForTests();
  newSharedCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setRvolSharedCacheForTests(null);
});

describe("RVOL scan: same results as before", () => {
  it("returns identical hits, candidates and diagnostics for the full recorded day", async () => {
    clock = et(20, 0);
    vi.setSystemTime(clock);
    const before = await Promise.all((["1m", "5m"] as const).map((resolution) => legacyScan({ resolution })));
    const after = await scanRvolBuySignalsForResolutions(["1m", "5m"]);
    // Twice: the second scan uses the per-instance reference/history caches.
    const afterWarm = await scanRvolBuySignalsForResolutions(["1m", "5m"]);
    for (const result of [after, afterWarm]) {
      expect(result).toEqual(before);
    }
    expect(before.map((scan) => scan.hits.length)).toEqual([4, 6]);
  }, 120_000);
});

describe("RVOL alerts cron: same alert decisions as before", () => {
  it("dispatches, pushes and Slack posts match the old cron tick for tick", async () => {
    const before = await runCronDay(legacyAlertsGET);
    resetRvolScannerCachesForTests();
    newSharedCache();
    const after = await runCronDay(currentAlertsGET);

    expect(after.dispatches).toEqual(before.dispatches);
    expect(after.pushes).toEqual(before.pushes);
    expect(after.slacks).toEqual(before.slacks);
    expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.responses).toEqual(before.responses);

    // The replay must exercise real decisions: sent alerts to the 3 opted-in users + Slack,
    // and at least one stale signal skipped.
    const statuses = before.dispatches.map((row) => row.status);
    expect(statuses.filter((status) => status === "sent").length).toBeGreaterThanOrEqual(9);
    expect(statuses).toContain("skipped");
    for (const push of before.pushes as Array<{ userIds: string[] }>) {
      expect(push.userIds).toEqual(PUSH_USERS);
    }
  }, 300_000);
});

describe("RVOL scanner route: pages get the same rows from the shared copy", () => {
  const VIEWS = [
    "mode=intraday&resolution=1m",
    "mode=intraday&resolution=5m",
    "mode=intraday&resolution=all",
    "mode=intraday&resolution=all&limit=20",
  ];

  function comparable(body: Record<string, unknown>) {
    // fetchedAt is "when computed" (now the scan time); everything else must match.
    const { fetchedAt: _fetchedAt, ...rest } = body;
    return rest;
  }

  it("matches the old per-request scan for every page view", async () => {
    // Today's alert history, as the cron would have written it by mid-afternoon.
    await runCronDay(currentAlertsGET);
    const db = fakes.db;
    for (const tick of [et(9, 45), et(13, 46), et(16, 1)]) {
      clock = tick;
      vi.setSystemTime(tick);
      for (const view of VIEWS) {
        fakes.db = db;
        resetRvolScannerCachesForTests();
        newSharedCache();
        const url = `https://longboard.test/api/command2/rvol-scanner?${view}`;
        const legacy = await legacyScannerGET(new Request(url));
        const current = await currentScannerGET(new Request(url));
        expect(current.status).toBe(200);
        expect(legacy.status).toBe(200);
        expect(comparable(await current.json())).toEqual(comparable(await legacy.json()));
      }
    }
  }, 300_000);

  it("serves later page reads from the shared copy without scanning again", async () => {
    clock = et(13, 46);
    vi.setSystemTime(clock);
    fakes.db = freshDb();
    const polygon = fakePolygonFetch(fixture, () => clock);
    vi.stubGlobal("fetch", polygon.fetchImpl);
    const url = "https://longboard.test/api/command2/rvol-scanner?mode=intraday&resolution=5m";
    await currentScannerGET(new Request(url));
    const afterFirst = polygon.stats.calls;
    expect(polygon.stats.byKind.snapshot).toBeGreaterThan(0);
    for (const view of VIEWS) {
      await currentScannerGET(new Request(`https://longboard.test/api/command2/rvol-scanner?${view}`));
    }
    expect(polygon.stats.calls).toBe(afterFirst);
  }, 120_000);
});
