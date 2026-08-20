import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTargetsForStock, type TargetInputStock } from "@/lib/morning-email/anthropic";
import { researchStockWithClaude } from "@/lib/morning-email/claude-research";
import { enrichStocks } from "@/lib/morning-email/research";
import { refreshMorningReportTicker, scanMorningMovers, type LiveTickerRefresh } from "@/lib/morning-email/polygon";
import { runLocalQa } from "@/lib/morning-email/qa";
import { buildEmailHtml } from "@/lib/morning-email/render-email";
import {
  DEFAULT_CLOSING_1,
  DEFAULT_CLOSING_2,
  DEFAULT_SUBJECT,
  type MorningEmailDraft,
  type MorningEmailStock,
  type PriceTargets,
  type QaMessage,
} from "@/lib/morning-email/types";
import { getEtReportWeekRange } from "@/lib/morning-report/schedule";
import {
  summarizeMorningReportWeek,
  type MorningReportVersionInput,
  type MorningReportWeekSummary,
} from "@/lib/morning-report/weekSummary";

export { isMorningBuildMinute } from "@/lib/morning-report/schedule";

export type ReportTrigger = "scheduled" | "admin" | "retry";
export type ReportVersionType = "morning_build" | "manual_full_regeneration" | "live_refresh" | "closing_refresh";
export type ReportJobType = "morning_build" | "manual_full_regeneration" | "live_refresh";
export type ReportJobStatus = "running" | "success" | "failed" | "skipped";

const POINTER_KEY = "command_center";
const REPORT_SCHEMA_VERSION = 1;
const NY_TZ = "America/New_York";

let serviceClient: SupabaseClient | null = null;

function adminSupabase(): SupabaseClient {
  if (!serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase service role is not configured");
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

function etYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function etDateLabel(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday").toUpperCase()} · ${get("month").toUpperCase()} ${get("day")} · ${get("year")}`;
}

function etTimeParts(d: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

export function isLiveRefreshWindow(d: Date = new Date()): boolean {
  const { hour, minute } = etTimeParts(d);
  const total = hour * 60 + minute;
  return total >= 7 * 60 && total <= 16 * 60;
}

function isClosingRefresh(d: Date = new Date()): boolean {
  const { hour, minute } = etTimeParts(d);
  return hour === 16 && minute === 0;
}

export function liveRefreshVersionType(d: Date = new Date()): ReportVersionType {
  return isClosingRefresh(d) ? "closing_refresh" : "live_refresh";
}

export function applyLiveRefreshResults(stocks: MorningEmailStock[], results: LiveTickerRefresh[]): {
  stocks: MorningEmailStock[];
  attempted: string[];
  succeeded: string[];
  failed: string[];
} {
  const attempted = asTickerList(stocks);
  const patches = new Map(results.filter((r) => r.ok).map((r) => [r.ticker, r.patch]));
  return {
    attempted,
    succeeded: Array.from(patches.keys()),
    failed: results.filter((r) => !r.ok).map((r) => r.ticker),
    stocks: stocks.map((stock) => {
      const patch = patches.get(stock.ticker.trim().toUpperCase());
      return patch ? { ...stock, ...patch } : stock;
    }),
  };
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function asTickerList(stocks: MorningEmailStock[]): string[] {
  return stocks.map((s) => s.ticker.trim().toUpperCase()).filter(Boolean);
}

function draftToPayload(draft: MorningEmailDraft, pricesUpdatedAt: string | null): Record<string, unknown> {
  return {
    report_schema_version: REPORT_SCHEMA_VERSION,
    date: draft.date,
    subject: draft.subject,
    stocks: draft.stocks,
    closing1: draft.closing1,
    closing2: draft.closing2,
    qa: draft.qa,
    prices_updated_at: pricesUpdatedAt,
  };
}

function payloadToDraft(row: MorningArchiveDbRow): MorningEmailDraft {
  const payload = row.payload_json && typeof row.payload_json === "object"
    ? row.payload_json as Record<string, unknown>
    : null;
  return {
    id: row.id,
    date: row.report_date ?? row.sent_date,
    subject: typeof payload?.subject === "string" ? payload.subject : row.subject,
    stocks: Array.isArray(payload?.stocks) ? payload.stocks as MorningEmailStock[] : row.stocks_json,
    closing1: typeof payload?.closing1 === "string" ? payload.closing1 : DEFAULT_CLOSING_1,
    closing2: typeof payload?.closing2 === "string" ? payload.closing2 : DEFAULT_CLOSING_2,
    qa: Array.isArray(payload?.qa) ? payload.qa as QaMessage[] : row.qa_json ?? [],
    html: row.html,
    createdAt: row.created_at,
    updatedAt: row.prices_updated_at ?? row.generated_at ?? row.created_at,
  };
}

type MorningArchiveDbRow = {
  id: string;
  sent_date: string;
  report_date: string | null;
  subject: string;
  stocks_json: MorningEmailStock[];
  qa_json: QaMessage[] | null;
  html: string;
  generated_by_email: string | null;
  created_at: string;
  generated_at: string | null;
  prices_updated_at: string | null;
  version_type: ReportVersionType | null;
  report_schema_version: number | null;
  payload_json: unknown;
};

export type CurrentMorningReport = {
  version_id: string;
  report_date: string;
  sent_date: string;
  subject: string;
  stocks_json: MorningEmailStock[];
  payload: Record<string, unknown>;
  html: string;
  qa_json: QaMessage[];
  generated_by_email: string | null;
  created_at: string;
  generated_at: string;
  prices_updated_at: string | null;
  version_type: ReportVersionType;
  report_schema_version: number;
};

export type MorningReportJobRun = {
  id: string;
  job_type: ReportJobType;
  trigger: ReportTrigger;
  status: ReportJobStatus;
  report_date: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  tickers_attempted: string[];
  tickers_succeeded: string[];
  tickers_failed: string[];
  error_summary: string | null;
  current_report_updated: boolean;
  email_html_regenerated: boolean;
  created_by_email: string | null;
};

type Actor = { id?: string | null; email?: string | null };

async function createJobRun(args: {
  jobType: ReportJobType;
  trigger: ReportTrigger;
  reportDate: string;
  actor?: Actor;
}): Promise<MorningReportJobRun> {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("morning_report_job_runs")
    .insert({
      job_type: args.jobType,
      trigger: args.trigger,
      status: "running",
      report_date: args.reportDate,
      created_by: args.actor?.id ?? null,
      created_by_email: args.actor?.email ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "failed to create job run");
  return data as MorningReportJobRun;
}

async function finishJobRun(id: string, patch: Partial<MorningReportJobRun> & {
  status: ReportJobStatus;
  error_details?: unknown;
  expensive_api_usage?: unknown;
}): Promise<MorningReportJobRun> {
  const admin = adminSupabase();
  const completedAt = new Date().toISOString();
  const existing = await admin
    .from("morning_report_job_runs")
    .select("started_at")
    .eq("id", id)
    .single();
  const startedAt = typeof existing.data?.started_at === "string" ? existing.data.started_at : completedAt;
  const { data, error } = await admin
    .from("morning_report_job_runs")
    .update({
      ...patch,
      completed_at: completedAt,
      duration_ms: durationMs(startedAt, completedAt),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "failed to finish job run");
  return data as MorningReportJobRun;
}

async function acquireLock(lockKey: string, jobRunId: string, ttlMinutes: number): Promise<boolean> {
  const admin = adminSupabase();
  await admin.from("morning_report_locks").delete().lt("expires_at", new Date().toISOString());
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const { error } = await admin
    .from("morning_report_locks")
    .insert({ lock_key: lockKey, job_run_id: jobRunId, expires_at: expiresAt });
  return !error;
}

async function releaseLock(lockKey: string, jobRunId: string): Promise<void> {
  const admin = adminSupabase();
  await admin
    .from("morning_report_locks")
    .delete()
    .eq("lock_key", lockKey)
    .eq("job_run_id", jobRunId);
}

async function hasActiveFullBuildLock(): Promise<boolean> {
  const admin = adminSupabase();
  const { data } = await admin
    .from("morning_report_locks")
    .select("lock_key")
    .eq("lock_key", "morning-report:full")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return Boolean(data);
}

export async function setCurrentReportVersion(versionId: string): Promise<void> {
  const admin = adminSupabase();
  await admin
    .from("morning_email_archive")
    .update({ is_current: false })
    .eq("current_pointer_key", POINTER_KEY)
    .eq("is_current", true);

  const { error } = await admin
    .from("morning_email_archive")
    .update({ is_current: true, current_pointer_key: POINTER_KEY })
    .eq("id", versionId);
  if (error) throw new Error(error.message);
}

export async function saveReportVersion(args: {
  draft: MorningEmailDraft;
  html: string;
  versionType: ReportVersionType;
  trigger: ReportTrigger;
  jobRunId: string | null;
  pricesUpdatedAt: string | null;
  generatedAt: string;
  actor?: Actor;
}): Promise<string> {
  const admin = adminSupabase();
  const payload = draftToPayload(args.draft, args.pricesUpdatedAt);
  const { data, error } = await admin
    .from("morning_email_archive")
    .insert({
      sent_date: args.draft.date,
      report_date: args.draft.date,
      subject: args.draft.subject,
      stocks_json: args.draft.stocks,
      qa_json: args.draft.qa,
      html: args.html,
      generated_by: args.actor?.id ?? null,
      generated_by_email: args.actor?.email ?? null,
      report_schema_version: REPORT_SCHEMA_VERSION,
      version_type: args.versionType,
      status: "success",
      is_current: false,
      current_pointer_key: POINTER_KEY,
      payload_json: payload,
      prices_updated_at: args.pricesUpdatedAt,
      generated_at: args.generatedAt,
      trigger: args.trigger,
      job_run_id: args.jobRunId,
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? "failed to save report version");
  await setCurrentReportVersion(data.id as string);
  return data.id as string;
}

async function selectedResearchEngine(): Promise<"claude" | "legacy"> {
  return process.env.RESEARCH_ENGINE === "legacy" ? "legacy" : "claude";
}

async function researchStocks(stocks: MorningEmailStock[]): Promise<{ stocks: MorningEmailStock[]; qa: QaMessage[]; expensiveUsage: Record<string, unknown> }> {
  const engine = await selectedResearchEngine();
  if (engine === "legacy") {
    const result = await enrichStocks(stocks);
    return {
      stocks: result.stocks,
      qa: [{ level: "ok", message: "RESEARCH_ENGINE=legacy — using OpenAI synthesis path." }, ...result.qa],
      expensiveUsage: { research_engine: "legacy" },
    };
  }

  try {
    const outcomes = await Promise.all(stocks.map((s) => researchStockWithClaude(s)));
    return {
      stocks: outcomes.map((o) => o.stock),
      qa: [
        { level: "ok", message: `Researched ${outcomes.length} ticker${outcomes.length === 1 ? "" : "s"} via Claude.` },
        ...outcomes.flatMap((o) => o.qa),
      ],
      expensiveUsage: { research_engine: "claude", tickers_researched: stocks.length },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const result = await enrichStocks(stocks);
    return {
      stocks: result.stocks,
      qa: [{ level: "warning", message: `Claude research path threw (${msg}); fell back to legacy pipeline.` }, ...result.qa],
      expensiveUsage: { research_engine: "legacy_fallback", claude_error: msg },
    };
  }
}

function toTargetInput(stock: MorningEmailStock): TargetInputStock {
  return {
    ticker: stock.ticker,
    name: stock.name,
    last: stock.last,
    change_pct: stock.change_pct,
    float: stock.float,
    volume: stock.volume,
    market_cap: stock.market_cap,
    catalyst: (Array.isArray(stock.catalyst) ? stock.catalyst : []).join(" "),
    source_urls: stock.source_urls,
  };
}

async function attachTargets(stocks: MorningEmailStock[]): Promise<{ stocks: MorningEmailStock[]; qa: QaMessage[]; expensiveUsage: Record<string, unknown> }> {
  const settled = await Promise.allSettled(
    stocks.map(async (s) => ({ ticker: s.ticker, result: await generateTargetsForStock(toTargetInput(s)) })),
  );
  const targets: Record<string, PriceTargets> = {};
  const qa: QaMessage[] = [];
  for (const item of settled) {
    if (item.status === "rejected") {
      qa.push({ level: "warning", message: `Target generation threw: ${item.reason instanceof Error ? item.reason.message : "unknown"}` });
      continue;
    }
    if (item.value.result.ok) {
      targets[item.value.ticker] = item.value.result.targets;
    } else {
      qa.push({ level: "warning", message: `${item.value.ticker}: target generation failed (${item.value.result.error}).` });
    }
  }
  return {
    stocks: stocks.map((s) => targets[s.ticker] ? { ...s, price_targets: targets[s.ticker] } : s),
    qa,
    expensiveUsage: { targets_attempted: stocks.length, targets_succeeded: Object.keys(targets).length },
  };
}

export async function runFullReportBuild(args: { trigger: ReportTrigger; actor?: Actor } = { trigger: "scheduled" }): Promise<MorningReportJobRun> {
  const reportDate = etYmd();
  const jobType: ReportJobType = args.trigger === "scheduled" ? "morning_build" : "manual_full_regeneration";
  const versionType: ReportVersionType = jobType;
  const job = await createJobRun({ jobType, trigger: args.trigger, reportDate, actor: args.actor });
  const locked = await acquireLock("morning-report:full", job.id, 45);
  if (!locked) {
    return finishJobRun(job.id, {
      status: "skipped",
      error_summary: "A full report generation is already running.",
    });
  }

  try {
    const scan = await scanMorningMovers({});
    if (scan.stocks.length === 0) {
      throw new Error(scan.qa.find((q) => q.level === "error")?.message ?? "No stocks returned by scan.");
    }

    const researched = await researchStocks(scan.stocks);
    const targeted = await attachTargets(researched.stocks);
    const qa: QaMessage[] = [...scan.qa, ...researched.qa, ...targeted.qa];
    const draft: MorningEmailDraft = {
      date: reportDate,
      subject: DEFAULT_SUBJECT,
      stocks: targeted.stocks,
      closing1: DEFAULT_CLOSING_1,
      closing2: DEFAULT_CLOSING_2,
      qa: [],
    };
    draft.qa = runLocalQa(draft).concat(qa);
    const generatedAt = new Date().toISOString();
    const html = buildEmailHtml(draft, { dateLabel: etDateLabel() });
    await saveReportVersion({
      draft,
      html,
      versionType,
      trigger: args.trigger,
      jobRunId: job.id,
      pricesUpdatedAt: generatedAt,
      generatedAt,
      actor: args.actor,
    });
    return finishJobRun(job.id, {
      status: "success",
      tickers_attempted: asTickerList(scan.stocks),
      tickers_succeeded: asTickerList(targeted.stocks),
      tickers_failed: [],
      current_report_updated: true,
      email_html_regenerated: true,
      expensive_api_usage: { ...researched.expensiveUsage, ...targeted.expensiveUsage },
    });
  } catch (e) {
    return finishJobRun(job.id, {
      status: "failed",
      error_summary: e instanceof Error ? e.message : "unknown",
      error_details: { message: e instanceof Error ? e.message : String(e) },
    });
  } finally {
    await releaseLock("morning-report:full", job.id);
  }
}

export async function runLiveRefresh(args: {
  trigger: ReportTrigger;
  actor?: Actor;
  ignoreWindow?: boolean;
  runAfterFullBuild?: boolean;
}): Promise<MorningReportJobRun> {
  const reportDate = etYmd();
  const job = await createJobRun({ jobType: "live_refresh", trigger: args.trigger, reportDate, actor: args.actor });

  if (!args.ignoreWindow && !isLiveRefreshWindow()) {
    return finishJobRun(job.id, { status: "skipped", error_summary: "Outside live refresh window." });
  }
  if (!args.runAfterFullBuild && await hasActiveFullBuildLock()) {
    return finishJobRun(job.id, { status: "skipped", error_summary: "Full report generation is running." });
  }
  const locked = await acquireLock("morning-report:live", job.id, 10);
  if (!locked) {
    return finishJobRun(job.id, { status: "skipped", error_summary: "A live refresh is already running." });
  }

  try {
    const current = await getCurrentReport();
    if (!current) throw new Error("No current report available to refresh.");
    const draft = payloadToDraft({
      id: current.version_id,
      sent_date: current.sent_date,
      report_date: current.report_date,
      subject: current.subject,
      stocks_json: current.stocks_json,
      qa_json: current.qa_json,
      html: current.html,
      generated_by_email: current.generated_by_email,
      created_at: current.created_at,
      generated_at: current.generated_at,
      prices_updated_at: current.prices_updated_at,
      version_type: current.version_type,
      report_schema_version: current.report_schema_version,
      payload_json: current.payload,
    });

    const attempted = asTickerList(draft.stocks);
    const results = await Promise.all(attempted.map((ticker) => refreshMorningReportTicker(ticker)));
    const refreshed = applyLiveRefreshResults(draft.stocks, results);

    if (refreshed.succeeded.length === 0) {
      return finishJobRun(job.id, {
        status: "failed",
        tickers_attempted: attempted,
        tickers_succeeded: [],
        tickers_failed: refreshed.failed,
        error_summary: "No tickers refreshed successfully.",
        current_report_updated: false,
        email_html_regenerated: false,
      });
    }

    const refreshedAt = new Date().toISOString();
    const nextDraft: MorningEmailDraft = {
      ...draft,
      stocks: refreshed.stocks,
      qa: draft.qa,
    };
    const html = buildEmailHtml(nextDraft, { dateLabel: etDateLabel(new Date(refreshedAt)) });
    await saveReportVersion({
      draft: nextDraft,
      html,
      versionType: liveRefreshVersionType(new Date(refreshedAt)),
      trigger: args.trigger,
      jobRunId: job.id,
      pricesUpdatedAt: refreshedAt,
      generatedAt: current.generated_at,
      actor: args.actor,
    });

    return finishJobRun(job.id, {
      status: "success",
      tickers_attempted: attempted,
      tickers_succeeded: refreshed.succeeded,
      tickers_failed: refreshed.failed,
      current_report_updated: true,
      email_html_regenerated: true,
    });
  } catch (e) {
    return finishJobRun(job.id, {
      status: "failed",
      error_summary: e instanceof Error ? e.message : "unknown",
      error_details: { message: e instanceof Error ? e.message : String(e) },
    });
  } finally {
    await releaseLock("morning-report:live", job.id);
  }
}

export async function getCurrentReport(): Promise<CurrentMorningReport | null> {
  const admin = adminSupabase();
  const select = "id, sent_date, report_date, subject, stocks_json, qa_json, html, generated_by_email, created_at, generated_at, prices_updated_at, version_type, report_schema_version, payload_json";
  let query = admin
    .from("morning_email_archive")
    .select(select)
    .eq("is_current", true)
    .eq("current_pointer_key", POINTER_KEY)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let { data, error } = await query;
  if (error || !data) {
    const fallback = await admin
      .from("morning_email_archive")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }
  if (error || !data) return null;
  const row = data as MorningArchiveDbRow;
  const draft = payloadToDraft(row);
  const payload = draftToPayload(draft, row.prices_updated_at ?? row.created_at);
  return {
    version_id: row.id,
    report_date: row.report_date ?? row.sent_date,
    sent_date: row.sent_date,
    subject: row.subject,
    stocks_json: draft.stocks,
    payload,
    html: row.html,
    qa_json: draft.qa,
    generated_by_email: row.generated_by_email,
    created_at: row.created_at,
    generated_at: row.generated_at ?? row.created_at,
    prices_updated_at: row.prices_updated_at ?? row.created_at,
    version_type: row.version_type ?? "manual_full_regeneration",
    report_schema_version: row.report_schema_version ?? REPORT_SCHEMA_VERSION,
  };
}

export async function getMorningReportWeekSummary(
  now: Date = new Date(),
): Promise<MorningReportWeekSummary> {
  const admin = adminSupabase();
  const { weekStart, weekEnd } = getEtReportWeekRange(now);
  const { data, error } = await admin
    .from("morning_email_archive")
    .select("report_date, sent_date, stocks_json, created_at")
    .gte("report_date", weekStart)
    .lte("report_date", weekEnd)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(`Unable to load the weekly morning report archive: ${error.message}`);
  return summarizeMorningReportWeek(
    (data ?? []) as MorningReportVersionInput[],
    weekStart,
    weekEnd,
  );
}

export async function getMorningReportStatus(): Promise<{
  current: CurrentMorningReport | null;
  recentJobs: MorningReportJobRun[];
  warnings: string[];
}> {
  const admin = adminSupabase();
  const current = await getCurrentReport();
  const { data } = await admin
    .from("morning_report_job_runs")
    .select("id, job_type, trigger, status, report_date, started_at, completed_at, duration_ms, tickers_attempted, tickers_succeeded, tickers_failed, error_summary, current_report_updated, email_html_regenerated, created_by_email")
    .order("started_at", { ascending: false })
    .limit(12);
  const recentJobs = (data ?? []) as MorningReportJobRun[];
  const warnings: string[] = [];
  const today = etYmd();
  const latestBuild = recentJobs.find((j) => j.job_type === "morning_build" || j.job_type === "manual_full_regeneration");
  if (latestBuild?.status === "failed") warnings.push("Morning/full report build failed.");
  if (!current || current.report_date !== today) warnings.push("Today’s expensive report content is missing.");
  if (current?.prices_updated_at && isLiveRefreshWindow()) {
    const staleMs = Date.now() - new Date(current.prices_updated_at).getTime();
    if (staleMs > 30 * 60_000) warnings.push("Live data is more than 30 minutes stale.");
  }
  const lastTwoRefreshes = recentJobs.filter((j) => j.job_type === "live_refresh").slice(0, 2);
  const failedCounts = new Map<string, number>();
  for (const job of lastTwoRefreshes) {
    for (const ticker of job.tickers_failed ?? []) {
      failedCounts.set(ticker, (failedCounts.get(ticker) ?? 0) + 1);
    }
  }
  for (const [ticker, count] of failedCounts) {
    if (count >= 2) warnings.push(`${ticker} failed refresh twice in a row.`);
  }
  return { current, recentJobs, warnings };
}
