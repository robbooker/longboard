import type { ChatEntitlements } from "@/lib/chatAccess";

/**
 * #468 The chat's owner (Rob): one account, named on the server by CHAT_OWNER_ACCOUNT_ID (his
 * Longboard sign-in's account id). This is narrower than an admin or a chat control owner
 * (longboard_chat_owners), which include other people. Only owner-only things (the Trading Desk)
 * use it, and only on the server: the browser is never asked who is the owner.
 *
 * Fails closed: with the setting missing or not an account id, nobody is the owner.
 */
export const CHAT_OWNER_ENV = "CHAT_OWNER_ACCOUNT_ID";

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured owner account id, or null when it is missing or malformed. */
export function chatOwnerAccountId(env: Record<string, string | undefined> = process.env): string | null {
  const value = env[CHAT_OWNER_ENV]?.trim().toLowerCase();
  return value && ACCOUNT_ID.test(value) ? value : null;
}

/** The parts of a verified sign-in (requireChatUser's ok result) the owner rule reads. */
export type OwnerCheckAuth = {
  user: { id: string };
  access: ChatEntitlements;
  /** A personal API token, not a browser sign-in. */
  apiToken?: boolean;
  /** An agent's token (its user is the agent's owner). */
  agent?: unknown;
};

/**
 * True only for the owner's own signed-in browser: the configured account, an admin, never a bot
 * account, never a personal API token and never an agent's token (an agent Rob owns signs in "as"
 * him, so it is refused here on purpose; agents will get their own read-only summary later).
 */
export function isChatOwner(auth: OwnerCheckAuth, env: Record<string, string | undefined> = process.env): boolean {
  const owner = chatOwnerAccountId(env);
  if (!owner) return false;
  if (auth.apiToken || auth.agent) return false;
  if (auth.access.botRooms) return false;
  if (!auth.access.admin) return false;
  return typeof auth.user.id === "string" && auth.user.id.toLowerCase() === owner;
}
