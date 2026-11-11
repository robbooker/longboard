// #436: the latest press release under a stock's first Gainers alert of the day. The facts route
// calls postGainersAlertNews right after the lookup's DilutionTracker news read is saved; the
// database (public.post_chat_gainers_alert_news) decides whether to post and keeps it to one per
// stock per Eastern day. The room's history read attaches the posted headline to its alert
// (withGainersAlertNews) and the room shows it under the alert's text (GainersAlertNews.tsx).
// DilutionTracker releases only: nothing here ever reads another news source.

/** One posted headline, as it rides on its alert. */
export type GainersAlertNews = { title: string; url: string; source: string; published_at: string };

/** What post_chat_gainers_alert_news answered, or "unavailable" when it couldn't be asked. */
export type GainersAlertNewsResult =
  "posted" | "duplicate" | "no_alert" | "too_late" | "no_news" | "stale" | "unavailable";
const REASONS = new Set(["duplicate", "no_alert", "too_late", "no_news", "stale"]);

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Asks the database to post the ticker's newest release under its first alert of `day`. Never throws. */
export async function postGainersAlertNews(
  db: RpcClient,
  day: string,
  ticker: string,
): Promise<GainersAlertNewsResult> {
  try {
    const { data, error } = await db.rpc("post_chat_gainers_alert_news", { p_day: day, p_ticker: ticker });
    if (error || !data || typeof data !== "object") return "unavailable";
    const result = data as { posted?: unknown; reason?: unknown };
    if (result.posted === true) return "posted";
    return typeof result.reason === "string" && REASONS.has(result.reason)
      ? (result.reason as GainersAlertNewsResult)
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

type SelectClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Gainers room only: each alert that has a posted headline gets it as `gainers_news`. Any other
 * room, or a failed read (the migration not applied yet included), leaves the messages as they are.
 */
export async function withGainersAlertNews<T extends { id: string; removed?: boolean | null }>(
  client: { from: unknown },
  room: string,
  messages: T[],
): Promise<Array<T & { gainers_news?: GainersAlertNews }>> {
  if (room !== "gainers") return messages;
  const ids = messages.filter((message) => !message.removed).map((message) => message.id);
  if (!ids.length) return messages;
  // The Supabase client, seen only as far as this one read needs (its full type is too deep here).
  const db = client as SelectClient;
  try {
    const { data, error } = await db
      .from("chat_gainers_alert_news")
      .select("alert_message_id,title,url,source,published_at")
      .in("alert_message_id", ids);
    if (error || !Array.isArray(data)) return messages;
    const byAlert = new Map<string, GainersAlertNews>();
    for (const row of data as Record<string, unknown>[]) {
      const url = safeUrl(row.url);
      if (
        typeof row.alert_message_id !== "string" ||
        typeof row.title !== "string" ||
        !row.title.trim() ||
        !url
      )
        continue;
      if (typeof row.published_at !== "string" || !Number.isFinite(Date.parse(row.published_at))) continue;
      byAlert.set(row.alert_message_id, {
        title: row.title,
        url,
        source: typeof row.source === "string" ? row.source : "",
        published_at: new Date(row.published_at).toISOString(),
      });
    }
    if (!byAlert.size) return messages;
    return messages.map((message) => {
      const news = byAlert.get(message.id);
      return news && !message.removed ? { ...message, gainers_news: news } : message;
    });
  } catch {
    return messages;
  }
}

const ET = "America/New_York";
const parts = (at: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ET, ...options })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

/**
 * When the release came out, in Eastern time: "7:02 AM ET" on the alert's own Eastern day, otherwise
 * with its date ("Nov 9, 7:02 AM ET"). Plain spaces (some browsers put a narrow space before AM).
 */
export function alertNewsTime(publishedAt: string, alertAt?: string) {
  const at = new Date(publishedAt);
  if (!Number.isFinite(at.getTime())) return "";
  const time = parts(at, { hour: "numeric", minute: "2-digit", hour12: true });
  const clock = `${time.hour}:${time.minute} ${String(time.dayPeriod ?? "").toUpperCase()} ET`;
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
  const alert = alertAt ? new Date(alertAt) : null;
  if (alert && Number.isFinite(alert.getTime()) && day(alert) === day(at)) return clock;
  const date = parts(at, { month: "short", day: "numeric" });
  return `${date.month} ${date.day}, ${clock}`;
}

/** The line under the headline: "ACCESS Newswire · 7:02 AM ET" (the wire left out when unknown). */
export function alertNewsMeta(news: GainersAlertNews, alertAt?: string) {
  return [news.source.trim(), alertNewsTime(news.published_at, alertAt)].filter(Boolean).join(" · ");
}
