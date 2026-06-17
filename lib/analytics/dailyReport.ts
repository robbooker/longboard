import { createSign } from "crypto";

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";

type EnvConfig = {
  ok: true;
  propertyId: string;
  clientEmail: string;
  privateKey: string;
  slackWebhookUrl: string;
};

type MissingConfig = {
  ok: false;
  missing: string[];
};

type RunReportRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

type RunReportResponse = {
  rows?: RunReportRow[];
};

type TotalMetrics = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  screenPageViews: number;
  eventCount: number;
  engagementRate: number;
};

type TopRow = {
  label: string;
  value: number;
};

export type DailyAnalyticsReport = {
  ok: true;
  date: string;
  propertyId: string;
  totals: TotalMetrics;
  previousTotals: TotalMetrics;
  topPages: TopRow[];
  topSources: TopRow[];
  slackPosted: boolean;
  slackStatus: number | null;
};

export type DailyAnalyticsResult = DailyAnalyticsReport | MissingConfig;

function requiredConfig(): EnvConfig | MissingConfig {
  const serviceJson = parseServiceAccountJson(process.env.GA4_SERVICE_ACCOUNT_JSON);
  const propertyId = firstPresent(process.env.GA4_PROPERTY_ID, process.env.GOOGLE_ANALYTICS_PROPERTY_ID);
  const clientEmail = firstPresent(
    process.env.GA4_CLIENT_EMAIL,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    serviceJson?.client_email,
  );
  const privateKey = normalizePrivateKey(firstPresent(
    process.env.GA4_PRIVATE_KEY,
    process.env.GOOGLE_PRIVATE_KEY,
    serviceJson?.private_key,
  ));
  const slackWebhookUrl = firstPresent(
    process.env.BUDDYCLAW_ROB_LIZ_WEBHOOK_URL,
    process.env.LONGBOARD_SLACK_WEBHOOK_URL,
  );

  const missing = [
    propertyId ? null : "GA4_PROPERTY_ID",
    clientEmail ? null : "GA4_CLIENT_EMAIL or GA4_SERVICE_ACCOUNT_JSON",
    privateKey ? null : "GA4_PRIVATE_KEY or GA4_SERVICE_ACCOUNT_JSON",
    slackWebhookUrl ? null : "BUDDYCLAW_ROB_LIZ_WEBHOOK_URL or LONGBOARD_SLACK_WEBHOOK_URL",
  ].filter(Boolean) as string[];

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, propertyId, clientEmail, privateKey, slackWebhookUrl };
}

function parseServiceAccountJson(raw: string | undefined) {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    return null;
  }
}

function firstPresent(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(config: EnvConfig): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: config.clientEmail,
    scope: GA_SCOPE,
    aud: TOKEN_URL,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(config.privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

async function getAccessToken(config: EnvConfig): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(config),
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token request failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google token response did not include an access token.");
  return payload.access_token;
}

async function runReport(config: EnvConfig, token: string, body: Record<string, unknown>): Promise<RunReportResponse> {
  const response = await fetch(`${ANALYTICS_BASE_URL}/properties/${config.propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GA4 runReport failed (${response.status}): ${text.slice(0, 400)}`);
  }
  return response.json() as Promise<RunReportResponse>;
}

function yesterdayIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function previousDateIso(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function metric(row: RunReportRow | undefined, index: number): number {
  const raw = row?.metricValues?.[index]?.value ?? "0";
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function totalMetrics(response: RunReportResponse): TotalMetrics {
  const row = response.rows?.[0];
  return {
    activeUsers: metric(row, 0),
    newUsers: metric(row, 1),
    sessions: metric(row, 2),
    screenPageViews: metric(row, 3),
    eventCount: metric(row, 4),
    engagementRate: metric(row, 5),
  };
}

function topRows(response: RunReportResponse): TopRow[] {
  return (response.rows ?? []).map((row) => ({
    label: row.dimensionValues?.[0]?.value || "(not set)",
    value: metric(row, 0),
  }));
}

function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "flat" : "new";
  const pct = ((current - previous) / previous) * 100;
  const prefix = pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(0)}%`;
}

function number(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDailyAnalyticsSlack(report: DailyAnalyticsReport): string {
  const topPages = report.topPages.length
    ? report.topPages.slice(0, 5).map((row, index) => `${index + 1}. ${row.label} (${number(row.value)} views)`).join("\n")
    : "No page rows returned.";
  const topSources = report.topSources.length
    ? report.topSources.slice(0, 5).map((row, index) => `${index + 1}. ${row.label} (${number(row.value)} sessions)`).join("\n")
    : "No source rows returned.";

  return [
    `*Longboard daily GA report*`,
    `Date: ${report.date}`,
    `Active users: *${number(report.totals.activeUsers)}* (${delta(report.totals.activeUsers, report.previousTotals.activeUsers)} vs prior day)`,
    `Sessions: *${number(report.totals.sessions)}* (${delta(report.totals.sessions, report.previousTotals.sessions)} vs prior day)`,
    `Views: *${number(report.totals.screenPageViews)}* (${delta(report.totals.screenPageViews, report.previousTotals.screenPageViews)} vs prior day)`,
    `Engagement rate: *${percent(report.totals.engagementRate)}*`,
    ``,
    `*Top pages*`,
    topPages,
    ``,
    `*Top sources*`,
    topSources,
    `_Sent to Buddyclaw #rob-liz from Longboard analytics automation._`,
  ].join("\n");
}

async function postSlack(config: EnvConfig, text: string): Promise<number> {
  const response = await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `Longboard daily GA report`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack post failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.status;
}

export async function runDailyAnalyticsReport(): Promise<DailyAnalyticsResult> {
  const config = requiredConfig();
  if (!config.ok) return config;

  const token = await getAccessToken(config);
  const date = yesterdayIso();
  const previousDate = previousDateIso(date);
  const metricNames = [
    "activeUsers",
    "newUsers",
    "sessions",
    "screenPageViews",
    "eventCount",
    "engagementRate",
  ];

  const [totals, previousTotals, topPages, topSources] = await Promise.all([
    runReport(config, token, {
      dateRanges: [{ startDate: date, endDate: date }],
      metrics: metricNames.map((name) => ({ name })),
    }),
    runReport(config, token, {
      dateRanges: [{ startDate: previousDate, endDate: previousDate }],
      metrics: metricNames.map((name) => ({ name })),
    }),
    runReport(config, token, {
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5,
    }),
    runReport(config, token, {
      dateRanges: [{ startDate: date, endDate: date }],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5,
    }),
  ]);

  const report: DailyAnalyticsReport = {
    ok: true,
    date,
    propertyId: config.propertyId,
    totals: totalMetrics(totals),
    previousTotals: totalMetrics(previousTotals),
    topPages: topRows(topPages),
    topSources: topRows(topSources),
    slackPosted: false,
    slackStatus: null,
  };

  report.slackStatus = await postSlack(config, formatDailyAnalyticsSlack(report));
  report.slackPosted = true;
  return report;
}
