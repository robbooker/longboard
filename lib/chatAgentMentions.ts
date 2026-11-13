/**
 * #455 Agents: mention alerts. GET /api/chat/agents/mentions?after=<cursor>&limit=<n> gives an
 * agent, with its own token, the room posts that @mention it since its cursor. Mentions are
 * recorded when a message is sent or edited (chat_agent_mentions, migration
 * 20261113120000_chat_agent_mentions.sql), so a poll is one small indexed read.
 */
import { NextResponse } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const BEFORE_AT = /[\p{L}\p{N}_@]/u;

/**
 * Does this text @mention `name`? The rule chat_agent_mention_scan applies: case-insensitive, the
 * "@" not after a letter, digit, "_" or "@", the name not running on into a letter, digit or "_",
 * and no longer member name (`memberNames`) starting at the same "@" ("@Luke Smith" is the member
 * Luke Smith, not the agent Luke).
 */
export function agentMentioned(text: string, name: string, memberNames: string[] = []) {
  const want = name.toLowerCase();
  if (!want) return false;
  const lower = text.toLowerCase();
  const fits = (at: number, candidate: string) =>
    lower.startsWith(candidate, at + 1) && !WORD_CHAR.test(text.charAt(at + 1 + candidate.length));
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    if (at > 0 && BEFORE_AT.test(text[at - 1])) continue;
    if (!fits(at, want)) continue;
    const longer = memberNames.some((m) => m.length > name.length && fits(at, m.toLowerCase()));
    if (!longer) return true;
  }
  return false;
}

export type AgentMention = {
  seq: number;
  id: string;
  room: string;
  author: string;
  authorIsAgent: boolean;
  body: string;
  replyTo: string | null;
  createdAt: string;
};

export const MENTIONS_DEFAULT_LIMIT = 50;
export const MENTIONS_MAX_LIMIT = 100;

/** `after` (a cursor from an earlier answer) and `limit` (1 to 100, default 50). */
export function parseMentionQuery(params: URLSearchParams) {
  const after = params.get("after");
  const limit = params.get("limit");
  if (after !== null && after !== "" && !/^\d{1,15}$/.test(after))
    return { error: "invalid_cursor" as const };
  if (limit !== null && limit !== "" && !/^\d{1,3}$/.test(limit)) return { error: "invalid_limit" as const };
  const n = limit ? Number(limit) : MENTIONS_DEFAULT_LIMIT;
  if (n < 1 || n > MENTIONS_MAX_LIMIT) return { error: "invalid_limit" as const };
  return { after: after ? Number(after) : null, limit: n };
}

/**
 * The database already keeps only readable rooms, live messages and other people's posts; this
 * checks the same again, and that the text still names the agent by its current name (a mention
 * made under an old name, before a rename, is dropped).
 */
export function filterAgentMentions(rows: unknown, agent: { id: string; name: string }, rooms: string[]) {
  if (!Array.isArray(rows)) return [];
  const out: AgentMention[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    if (!row || typeof row !== "object") continue;
    const { seq, id, room, author, authorAgentId, body, replyTo, createdAt } = row;
    if (typeof id !== "string" || typeof room !== "string" || typeof body !== "string") continue;
    if (!rooms.includes(room) || authorAgentId === agent.id || !agentMentioned(body, agent.name)) continue;
    out.push({
      seq: Number(seq),
      id,
      room,
      author: typeof author === "string" ? author : "",
      authorIsAgent: typeof authorAgentId === "string",
      body,
      replyTo: typeof replyTo === "string" ? replyTo : null,
      createdAt: typeof createdAt === "string" ? createdAt : "",
    });
  }
  return out;
}

/**
 * Polls per agent: 30 a minute (one every 2 seconds), kept apart from posting limits. Counted per
 * server instance, so it bounds a busy loop rather than giving an exact number.
 */
export const MENTION_POLLS_PER_MINUTE = 30;
const polls = new Map<string, number[]>();
export function mentionPollAllowed(agentId: string, now = Date.now()) {
  const recent = (polls.get(agentId) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= MENTION_POLLS_PER_MINUTE) {
    polls.set(agentId, recent);
    return { ok: false as const, retryAfter: Math.max(1, Math.ceil((recent[0] + 60_000 - now) / 1000)) };
  }
  recent.push(now);
  polls.set(agentId, recent);
  if (polls.size > 5000)
    for (const key of polls.keys())
      if (key !== agentId) {
        polls.delete(key);
        break;
      }
  return { ok: true as const };
}
export function resetMentionPolls() {
  polls.clear();
}

export async function readAgentMentions(params: URLSearchParams, auth: ChatAuthResult) {
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!auth.agent)
    return json(
      {
        error: "agent_token_required",
        message:
          "Mention alerts are for agent tokens. Make an agent on chat.robbooker.com/chat/developers and call this with its token.",
      },
      403,
    );
  const query = parseMentionQuery(params);
  if ("error" in query) return json({ error: query.error }, 400);
  const allowed = mentionPollAllowed(auth.agent.id);
  if (!allowed.ok)
    return json(
      {
        error: "mentions_rate_limited",
        message: `Check for mentions at most ${MENTION_POLLS_PER_MINUTE} times a minute.`,
        retryAfter: allowed.retryAfter,
      },
      429,
      { "Retry-After": String(allowed.retryAfter) },
    );
  const rooms = auth.access.botRooms ?? [];
  const db = createChatAdminClient();
  if (!db) return json({ error: "chat_unavailable" }, 503);
  const { data, error } = await db.rpc("chat_agent_mentions_since", {
    p_agent: auth.agent.id,
    p_rooms: rooms,
    p_after: query.after,
    p_limit: query.limit,
  });
  if (error?.code === "PGRST202" || error?.code === "42883")
    return json({ error: "mentions_unavailable", message: "Mention alerts aren't switched on yet." }, 503);
  if (error || !data || typeof data !== "object") return json({ error: "chat_unavailable" }, 503);
  const page = data as { mentions?: unknown; cursor?: unknown; more?: unknown };
  const cursor = typeof page.cursor === "number" ? page.cursor : Number(page.cursor ?? query.after ?? 0);
  return json({
    mentions: filterAgentMentions(page.mentions, auth.agent, rooms),
    cursor: String(Number.isFinite(cursor) ? cursor : (query.after ?? 0)),
    more: page.more === true,
  });
}
