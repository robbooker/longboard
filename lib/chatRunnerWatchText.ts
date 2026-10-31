// #341: wording and link handling for Runner Risk Watch. No server code, so the chat page can load it too.
export const RUNNER_WATCH_LABEL = "AI-generated research from Jake's watchlist. Check it against the filings. Not trade advice.";
export const RUNNER_WATCH_ROOM_PATH = "/chat?room=runner-watch";
const POST_SUMMARY_MAX = 280;
const URLS = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+/gi;

/** "More about SGRX here", or generic wording when the report names no ticker. */
export function runnerWatchLinkLabel(tickers: readonly string[]): string {
  if (!tickers.length) return "More about this update here";
  if (tickers.length === 1) return `More about ${tickers[0]} here`;
  if (tickers.length <= 3) return `More about ${tickers.slice(0, -1).join(", ")} and ${tickers.at(-1)} here`;
  return `More about ${tickers.slice(0, 3).join(", ")} and ${tickers.length - 3} more here`;
}

/** The chat post: short summary, link, label. Never over the room's 600 characters. Its only link is ours. */
export function composeRunnerWatchPost(input: { tickers: readonly string[]; summary: string; alert: boolean; url: string; mainRoom?: boolean }): string {
  let short = input.summary.replace(URLS, " ").replace(/\s+/g, " ").trim();
  if (short.length > POST_SUMMARY_MAX) {
    const cut = short.slice(0, POST_SUMMARY_MAX - 1);
    const space = cut.lastIndexOf(" ");
    short = (space > 200 ? cut.slice(0, space) : cut).trimEnd() + "…";
  }
  if (!short) short = "New Runner Risk Watch update.";
  // In LB and SS nobody has the room's context, so the post says what it is first.
  const lead = input.mainRoom ? `Runner Risk Watch${input.alert ? " alert" : ""}: ` : input.alert ? "Alert: " : "";
  return `${lead}${short}\n\n${runnerWatchLinkLabel(input.tickers)}: ${input.url}\n${RUNNER_WATCH_LABEL}`;
}

const POST_LINK = /(More about [^\n:]{1,60} here): https?:\/\/[^\s/]+(\/runner-watch\/[0-9a-f-]{36})(?=\n|$)/;

/** Splits a bot post so the chat can show its link under the words "More about SGRX here". */
export function runnerWatchPostLink(body: string): { before: string; label: string; href: string; after: string } | null {
  const match = POST_LINK.exec(body);
  if (!match) return null;
  return {
    before: body.slice(0, match.index),
    label: match[1],
    href: match[2],
    after: body.slice(match.index + match[0].length),
  };
}

export type RunnerWatchPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string };

/** A link only if it is really http or https with no login in it. Anything else stays visible as text. */
export function safeRunnerWatchHref(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

const REPORT_LINKS = /\[([^\]\n]{1,300})\]\(([^()\s]{1,2000})\)|https?:\/\/[^\s<>"'()[\]{}]+/gi;

/** The report's text with its links picked out: bare addresses and [words](address). Never HTML. */
export function runnerWatchReportParts(text: string): RunnerWatchPart[] {
  const parts: RunnerWatchPart[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.kind === "text") last.value += value;
    else parts.push({ kind: "text", value });
  };
  for (const match of text.matchAll(REPORT_LINKS)) {
    const index = match.index ?? 0;
    pushText(text.slice(cursor, index));
    cursor = index + match[0].length;
    if (match[1] !== undefined) {
      const href = safeRunnerWatchHref(match[2]);
      if (href) parts.push({ kind: "link", value: match[1], href });
      else pushText(match[0]);
      continue;
    }
    const bare = match[0].replace(/[.,!?;:]+$/, "");
    const href = safeRunnerWatchHref(bare);
    if (href) parts.push({ kind: "link", value: bare, href });
    else pushText(bare);
    pushText(match[0].slice(bare.length));
  }
  pushText(text.slice(cursor));
  return parts;
}
