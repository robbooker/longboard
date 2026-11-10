/**
 * #415 Trader Radio in the Gainers room: the listening rules, shared by the server routes and the
 * player. These mirror TraderRadio.ai's own player (src/app/use-squawkbox-audio-playback.ts in the
 * TraderRadio project) so a member hears the same squawks in the same order as on the site.
 */

export const RADIO_EVENT_TYPES = ["alert", "session", "overview", "station", "episode"] as const;
export type RadioEventType = (typeof RADIO_EVENT_TYPES)[number];

/** One squawk as the playout route hands it to the player: only what the listening rules need. */
export type RadioEvent = {
  at: string;
  type: RadioEventType;
  line: string;
  /** A signed Longboard clip address (see lib/chatRadioAccess.ts), never the relay's own. */
  audioUrl: string;
  symbol?: string;
  session?: string;
  sourceId?: string;
  sourceTime?: string;
  playlistId?: string;
  sequenceIndex?: number;
};

export type RadioPlayout = {
  /** False when the relay has stopped writing or its table could not be read. */
  live: boolean;
  generatedAt: string | null;
  events: RadioEvent[];
};

/** On start, the newest squawk is played only if it is at most this old (TraderRadio's window). */
export const RADIO_START_WINDOW_MS = 30 * 60_000;
/** How often a playing radio asks for the playout (TraderRadio polls every 10 seconds). */
export const RADIO_POLL_MS = 10_000;
/** The breath between two clips, and after a skipped one. */
export const RADIO_GAP_MS = 750;
/** A clip that makes no progress for this long is skipped. */
export const RADIO_STALL_MS = 15_000;

/** TraderRadio's sanitizePlayout: lines its site never plays. */
export function radioLineBlocked(line: string, type: string) {
  if (type === "station" && /\blive\b/i.test(line)) return true;
  return [
    /\bmarkets?\s+(?:are|will be|remain|remains)\s+closed\s+(?:today|friday|for|because|due to|in observance)/i,
    /\bmarkets?\s+closed\s+(?:today|friday|for|because|due to|in observance)/i,
    /\bclosed\s+(?:today|friday)\s+(?:for|because|due to|in observance of)/i,
  ].some((pattern) => pattern.test(line));
}

/**
 * TraderRadio's identity for one squawk. Its last fallback part is the relay's audio address; here
 * that is the signed clip address, which is just as fixed for a given clip.
 */
export function radioEventKey(event: RadioEvent) {
  if (event.type === "alert") {
    if (event.sourceId) return `alert|${event.sourceId}`;
    return ["alert", event.sourceTime ?? "", event.symbol ?? "", event.line].join("|");
  }
  return `${event.at}-${event.type}-${event.symbol ?? event.session ?? "event"}-${event.audioUrl}`;
}

const eventTime = (event: RadioEvent) => {
  const time = Date.parse(event.at);
  return Number.isFinite(time) ? time : 0;
};

/** Oldest first; squawks made in the same instant keep their playlist order. */
export function radioEventsInOrder(events: RadioEvent[]) {
  return events
    .filter((event) => !!event.audioUrl)
    .sort((a, b) => eventTime(a) - eventTime(b) || (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
}

/**
 * What a member hears when they press play: the newest squawk (with the rest of its playlist) if it
 * is under 30 minutes old, and nothing older. Everything already in the playout counts as heard,
 * so starting never replays a backlog.
 */
export function radioStartQueue(events: RadioEvent[], startedAt: number) {
  const existing = radioEventsInOrder(events);
  const latest = [...existing]
    .reverse()
    .find((event) => startedAt - eventTime(event) <= RADIO_START_WINDOW_MS);
  const queue = !latest
    ? []
    : latest.playlistId
      ? existing.filter((event) => event.playlistId === latest.playlistId)
      : [latest];
  return { queue, heard: new Set(existing.map(radioEventKey)) };
}

/** Squawks that arrived after play was pressed and have not been queued yet; marks them heard. */
export function radioNewEvents(events: RadioEvent[], startedAt: number, heard: Set<string>) {
  const fresh: RadioEvent[] = [];
  for (const event of radioEventsInOrder(events)) {
    const key = radioEventKey(event);
    if (eventTime(event) < startedAt || heard.has(key)) continue;
    heard.add(key);
    fresh.push(event);
  }
  return fresh;
}

/** What the control says is playing (TraderRadio's wording). */
export function radioEventLabel(event: RadioEvent) {
  if (event.type === "episode") return "Evening episode";
  if (event.type === "overview") return "Market overview";
  if (event.type === "station") return "Station ID";
  if (event.type === "session") return event.line || event.session || "Session";
  return event.symbol ?? event.session ?? event.type;
}
