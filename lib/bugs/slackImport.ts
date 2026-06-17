import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SlackMessage = {
  type?: string;
  subtype?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  ts?: string;
  thread_ts?: string;
};

type SlackHistoryResponse = {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

type SlackPermalinkResponse = {
  ok: boolean;
  error?: string;
  permalink?: string;
};

export type SlackBugImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
};

const DEFAULT_LOOKBACK_HOURS = 48;
const MAX_PAGES = 3;
const HISTORY_LIMIT = 100;
const TITLE_MAX_LEN = 240;
const DESCRIPTION_MAX_LEN = 4000;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function isSlackBugImportConfigured() {
  return Boolean(process.env.SLACK_BUGS_BOT_TOKEN?.trim() && process.env.SLACK_BUGS_CHANNEL_ID?.trim());
}

function createAdminClient(): SupabaseClient {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function configuredLookbackHours() {
  const value = Number(process.env.SLACK_BUGS_IMPORT_LOOKBACK_HOURS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LOOKBACK_HOURS;
}

function stripSlackMarkup(text: string) {
  return text
    .replace(/<mailto:([^|>]+)(?:\|[^>]+)?>/g, "$1")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function titleForMessage(message: SlackMessage) {
  const text = stripSlackMarkup(message.text ?? "");
  const firstLine = text.split("\n").find(Boolean)?.trim();
  const title = firstLine || `Slack bug report from ${message.user ?? "unknown user"}`;
  return title.length <= TITLE_MAX_LEN ? title : `${title.slice(0, TITLE_MAX_LEN - 1)}...`;
}

function descriptionForMessage(message: SlackMessage, permalink: string | null) {
  const lines = [
    stripSlackMarkup(message.text ?? ""),
    "",
    `Slack user: ${message.user ?? "unknown"}`,
    `Slack message: ${message.ts ?? "unknown"}`,
  ];
  if (message.thread_ts && message.thread_ts !== message.ts) {
    lines.push(`Slack thread: ${message.thread_ts}`);
  }
  if (permalink) lines.push(`Slack link: ${permalink}`);

  const description = lines.join("\n").trim();
  return description.length <= DESCRIPTION_MAX_LEN
    ? description
    : `${description.slice(0, DESCRIPTION_MAX_LEN - 1)}...`;
}

function shouldImportMessage(message: SlackMessage) {
  if (message.type !== "message") return false;
  if (!message.ts) return false;
  if (message.bot_id) return false;
  if (message.subtype) return false;
  return Boolean(stripSlackMarkup(message.text ?? ""));
}

async function slackApi<T>(token: string, method: string, params: URLSearchParams): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => null) as T | null;
  if (!response.ok || !json) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }
  return json;
}

async function getPermalink(token: string, channel: string, messageTs: string) {
  const params = new URLSearchParams({ channel, message_ts: messageTs });
  const data = await slackApi<SlackPermalinkResponse>(token, "chat.getPermalink", params);
  return data.ok ? data.permalink ?? null : null;
}

async function readRecentMessages(token: string, channel: string) {
  const oldest = String(Math.floor(Date.now() / 1000 - configuredLookbackHours() * 60 * 60));
  const messages: SlackMessage[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      channel,
      oldest,
      limit: String(HISTORY_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);

    const data = await slackApi<SlackHistoryResponse>(token, "conversations.history", params);
    if (!data.ok) throw new Error(`conversations.history failed: ${data.error ?? "unknown_error"}`);
    messages.push(...(data.messages ?? []));
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }

  return messages.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
}

export async function importSlackBugReports(): Promise<SlackBugImportResult> {
  const token = requiredEnv("SLACK_BUGS_BOT_TOKEN");
  const channel = requiredEnv("SLACK_BUGS_CHANNEL_ID");
  const admin = createAdminClient();
  const result: SlackBugImportResult = { ok: true, imported: 0, skipped: 0, duplicates: 0, errors: [] };

  const messages = await readRecentMessages(token, channel);

  for (const message of messages) {
    if (!shouldImportMessage(message)) {
      result.skipped += 1;
      continue;
    }

    let permalink: string | null = null;
    try {
      permalink = await getPermalink(token, channel, message.ts!);
    } catch {
      permalink = null;
    }

    const { error } = await admin.from("bug_report_queue").insert({
      title: titleForMessage(message),
      description: descriptionForMessage(message, permalink),
      page_url: permalink,
      status: "pending",
      source: "slack",
      reported_by_email: message.user ? `slack:${message.user}` : null,
      slack_channel_id: channel,
      slack_message_ts: message.ts,
      slack_thread_ts: message.thread_ts ?? message.ts,
      slack_user_id: message.user ?? null,
      slack_permalink: permalink,
    });

    if (!error) {
      result.imported += 1;
    } else if (error.code === "23505") {
      result.duplicates += 1;
    } else {
      result.errors.push(error.message);
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
