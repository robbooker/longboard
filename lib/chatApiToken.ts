import { randomBytes } from "node:crypto";
import { chatSecretHash } from "@/lib/chatLoginProof";

/**
 * CHAT-API: personal API tokens. A token is "lbc_" plus 43 random characters; only its SHA-256
 * is stored. It acts exactly as its owner, on the chat routes below only: never admin tools,
 * AI features, sign-in, phone notifications or token management.
 */
export const CHAT_API_TOKEN_PREFIX = "lbc_";
const TOKEN = /^lbc_[A-Za-z0-9_-]{43}$/;

export const CHAT_API_ROUTES = new Set([
  "/api/chat",
  "/api/chat/activity",
  "/api/chat/attachments",
  "/api/chat/dm-members",
  "/api/chat/events",
  "/api/chat/history",
  "/api/chat/inbox",
  "/api/chat/member",
  "/api/chat/mentions",
  "/api/chat/message",
  "/api/chat/message-pins",
  "/api/chat/message-reactions",
  "/api/chat/opening",
  "/api/chat/reactions",
  "/api/chat/realtime-token",
  "/api/chat/room-members",
  "/api/chat/search",
  "/api/chat/search/context",
  "/api/chat/thread",
  "/api/chat/thread-counts",
  "/api/chat/updates",
]);

export function chatApiRouteAllowed(path: string | undefined) {
  if (!path) return false;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  // Files: /api/chat/attachments/<id> and its transcript.
  return CHAT_API_ROUTES.has(clean) || /^\/api\/chat\/attachments\/[0-9a-f-]{36}(\/transcript)?$/i.test(clean);
}

/** The token from an `Authorization: Bearer lbc_…` header; undefined when there is no API token. */
export function bearerChatApiToken(header: string | null): string | null | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match || !match[1].startsWith(CHAT_API_TOKEN_PREFIX)) return undefined;
  return TOKEN.test(match[1]) ? match[1] : null;
}

export function newChatApiToken() {
  const token = CHAT_API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: chatSecretHash(token), hint: token.slice(-4) };
}
