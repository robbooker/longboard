/**
 * #450 Agents in chat, phase 1. An agent is a named identity a developer-access member runs with
 * its own lbc_ tokens. Its posts are rows of the owner's member with agent_id set (migration
 * 20261112120000_chat_agents.sql), shown with an "Agent" badge and "run by <owner>".
 *
 * Two layers of permission: a global ceiling (admins) and each agent's owner settings, which can
 * only narrow it. The database computes the effective permission (chat_agent_effective) and
 * enforces it on every send; effectiveAgentPermissions mirrors it for pages and tests.
 *
 * Client-safe: no server imports.
 */
import { CHAT_ROOMS } from "./publicChat";

/** Room slugs an agent setting may name ('agents' is the phase 2 Agents room). Never 'admins'. */
export const AGENT_ROOMS = [
  "main",
  "social",
  "shortscout",
  "lb-announcements",
  "ss-announcements",
  "gainers",
  "lb-recordings",
  "ss-recordings",
  "whats-new",
  "developers",
  "lb-review",
  "runner-watch",
  "club",
  "agents",
] as const;
export type AgentRoom = (typeof AGENT_ROOMS)[number];
/** A room's name for the settings pages ("agents" is the room phase 2 adds). */
export const agentRoomLabel = (slug: string) =>
  slug === "agents" ? "Agents (coming soon)" : (CHAT_ROOMS.find((room) => room.slug === slug)?.label ?? slug);
export const AGENT_LIMIT = 3;
export const AGENT_TOKEN_LIMIT = 3;
export const AGENT_LIMIT_BOUNDS = { perMinute: 60, perDay: 5000, maxTurns: 50 } as const;

export type AgentCeiling = {
  readRooms: string[];
  postRooms: string[];
  dm: boolean;
  react: boolean;
  thread: boolean;
  perMinute: number;
  perDay: number;
  /** The back-and-forth limit: agent posts in a row in one conversation. */
  maxTurns: number;
  updatedAt?: string;
};
/** An owner's settings: null rooms or limits mean "whatever the ceiling allows". */
export type AgentSettings = {
  readRooms: string[] | null;
  postRooms: string[] | null;
  dm: boolean;
  react: boolean;
  thread: boolean;
  perMinute: number | null;
  perDay: number | null;
};
export type AgentPermissions = Omit<AgentCeiling, "updatedAt">;

const sorted = (rooms: string[]) => [...new Set(rooms)].sort();

/** The intersection of the ceiling and the owner's settings (same rule as chat_agent_effective). */
export function effectiveAgentPermissions(ceiling: AgentCeiling, agent: AgentSettings): AgentPermissions {
  const readRooms = sorted(
    ceiling.readRooms.filter((room) => (agent.readRooms ?? ceiling.readRooms).includes(room)),
  );
  const postRooms = sorted(
    ceiling.postRooms.filter(
      (room) => (agent.postRooms ?? ceiling.postRooms).includes(room) && readRooms.includes(room),
    ),
  );
  return {
    readRooms,
    postRooms,
    dm: ceiling.dm && agent.dm,
    react: ceiling.react && agent.react,
    thread: ceiling.thread && agent.thread,
    perMinute: Math.min(ceiling.perMinute, agent.perMinute ?? ceiling.perMinute),
    perDay: Math.min(ceiling.perDay, agent.perDay ?? ceiling.perDay),
    maxTurns: ceiling.maxTurns,
  };
}

/**
 * The first owner setting wider than the ceiling, or null when the patch only narrows. The
 * database refuses the same patches (chat_agent_update answers 'outside_ceiling').
 */
export function agentPatchOutsideCeiling(ceiling: AgentCeiling, patch: Partial<AgentSettings>) {
  if (patch.readRooms?.some((room) => !ceiling.readRooms.includes(room))) return "readRooms";
  if (patch.postRooms?.some((room) => !ceiling.postRooms.includes(room))) return "postRooms";
  for (const key of ["dm", "react", "thread"] as const) if (patch[key] && !ceiling[key]) return key;
  if (patch.perMinute != null && patch.perMinute > ceiling.perMinute) return "perMinute";
  if (patch.perDay != null && patch.perDay > ceiling.perDay) return "perDay";
  return null;
}

/** Recent agent posts: is there room for one more (the per-minute and per-day limits)? */
export function agentRateLimit(
  postTimes: number[],
  limits: { perMinute: number; perDay: number },
  now = Date.now(),
): null | "minute" | "day" {
  const minute = postTimes.filter((t) => t >= now - 60_000).length;
  const day = postTimes.filter((t) => t >= now - 86_400_000).length;
  if (minute >= limits.perMinute) return "minute";
  if (day >= limits.perDay) return "day";
  return null;
}

/**
 * The back-and-forth limit, as send_chat_agent_message applies it. `recent` is the conversation's
 * latest posts, newest first, without bot posts (a thread: its original message and replies;
 * otherwise the room's top-level messages); each says which agent wrote it (null for a person).
 * The post is refused when the last `maxTurns` posts are all by agents and either the new post
 * replies to or names another agent, or another agent is in that run. A person's post resets it.
 */
export function agentTurnLimitReached(
  recent: Array<{ agentId: string | null }>,
  poster: string,
  maxTurns: number,
  targetsOtherAgent: boolean,
) {
  const run = recent.slice(0, maxTurns);
  if (run.length < maxTurns || run.some((post) => post.agentId === null)) return false;
  return targetsOtherAgent || run.some((post) => post.agentId !== poster);
}

/**
 * Chat API routes an agent token may use: reading rooms, threads and search, following along
 * live, posting and reacting. Never DMs, profile or name changes, pins, file uploads, edits, the
 * inbox or mentions, nor anything already closed to personal tokens (admin, AI, sign-in,
 * notifications, token management).
 */
export const CHAT_AGENT_ROUTES = new Set([
  "/api/chat",
  "/api/chat/events",
  "/api/chat/history",
  "/api/chat/message-reactions",
  "/api/chat/reactions",
  "/api/chat/realtime-token",
  "/api/chat/search",
  "/api/chat/search/context",
  "/api/chat/thread",
  "/api/chat/thread-counts",
  "/api/chat/updates",
]);

export function chatAgentRouteAllowed(path: string | undefined) {
  if (!path) return false;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return CHAT_AGENT_ROUTES.has(clean);
}

/** What an agent token's sign-in carries (chat_agent_request_context). */
export type ChatAgentIdentity = AgentPermissions & { id: string; name: string; ownerId: string };

export function parseAgentIdentity(value: unknown): ChatAgentIdentity | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const rooms = (x: unknown) => (Array.isArray(x) ? x.filter((r): r is string => typeof r === "string") : []);
  const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.ownerId !== "string") return null;
  return {
    id: v.id,
    name: v.name,
    ownerId: v.ownerId,
    readRooms: rooms(v.readRooms),
    postRooms: rooms(v.postRooms),
    dm: v.dm === true,
    react: v.react === true,
    thread: v.thread === true,
    perMinute: count(v.perMinute),
    perDay: count(v.perDay),
    maxTurns: count(v.maxTurns),
  };
}

/** The agent a message was posted by, as reads attach it. */
export type ChatMessageAgent = { id: string; name: string; owner: string };

/** People-facing text for a refused agent send (send_chat_agent_message statuses). */
export function agentSendError(status: string, extra: { reason?: string; limit?: number } = {}) {
  switch (status) {
    case "agent_paused":
      return { status: 403, error: "agent_paused", message: "This agent is paused." };
    case "agent_unavailable":
      return { status: 401, error: "invalid_token", message: "This agent no longer exists." };
    case "room_not_allowed":
      return { status: 403, error: "room_not_allowed", message: "This agent may not post in this room." };
    case "threads_not_allowed":
      return { status: 403, error: "threads_not_allowed", message: "This agent may not reply in threads." };
    case "files_not_allowed":
      return { status: 403, error: "files_not_allowed", message: "Agents can't post files yet." };
    case "agent_rate_limited":
      return {
        status: 429,
        error: "agent_rate_limited",
        message:
          extra.reason === "day"
            ? `This agent has posted its ${extra.limit ?? ""} messages for today.`.replace("its  ", "its ")
            : `This agent can post ${extra.limit ?? "a few"} messages a minute. Wait a moment.`,
      };
    case "agent_turn_limit":
      return {
        status: 429,
        error: "agent_turn_limit",
        message: `Agents have posted ${extra.limit ?? 6} times in a row here. A person needs to post before an agent answers again.`,
      };
    default:
      return null;
  }
}
