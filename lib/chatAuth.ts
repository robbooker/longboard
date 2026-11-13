import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_SESSION_COOKIE } from "@/lib/chatLoginConfig";
import { chatSecretHash, validChatLoginSecret } from "@/lib/chatLoginProof";
import type { ChatEntitlements } from "@/lib/chatAccess";
import { shortscoutChatEntitlements, isPaidShortScoutLevel } from "@/lib/shortscoutPolicy";
import { readRequestContext } from "@/lib/chatRequestContext";
import type { ChatServerTiming } from "@/lib/chatServerTiming";
import { bearerChatApiToken, chatApiRouteAllowed } from "@/lib/chatApiToken";
import { shortScoutFromCopy } from "@/lib/chatRequestContext";
import { sessionRole } from "@/lib/chatRole";
import { memberKeys } from "@/lib/memberAccess";
import { allowedChatRooms } from "@/lib/chatAccess";
import { chatAgentRouteAllowed, parseAgentIdentity, type ChatAgentIdentity } from "@/lib/chatAgents";

/** #444: the linked ShortScout account behind a bridged membership, left out otherwise. */
const bridgedSource = (renewal: { bridged: boolean; identity: { source_account_id?: string } | null }) =>
  renewal.bridged && typeof renewal.identity?.source_account_id === "string"
    ? { shortScoutSourceAccountId: renewal.identity.source_account_id }
    : {};
/** #384: the access field for entitlement keys, left out when there are none. */
const withMember = (keys: unknown) => {
  const member = memberKeys(keys);
  return member.length ? { member } : {};
};
export type ChatAuthResult =
  | {
      ok: true;
      user: { id: string; email: string; role: "user" | "admin" };
      access: ChatEntitlements;
      serverSession: boolean;
      hasSeparateShortScoutProfile?: boolean;
      /** #444: the linked ShortScout account (when bridged), to tell whether it still has its own profile. */
      shortScoutSourceAccountId?: string;
      /** CHAT-API: the request carried a personal API token instead of a browser sign-in. */
      apiToken?: boolean;
      /**
       * #450: the request carried an agent's token. user is the agent's owner (role "user", never
       * admin) and access.botRooms holds only the rooms the agent may read.
       */
      agent?: ChatAgentIdentity;
    }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * The Longboard sign-in, verified locally against the project's signing keys (no Auth server
 * round trip). Its session is checked in the database by the request context, so signing out
 * still ends chat access straight away.
 */
async function longboardSignIn() {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    const claims = data?.claims;
    return typeof claims?.sub === "string" && typeof claims.session_id === "string"
      ? { user: claims.sub, session: claims.session_id }
      : null;
  } catch {
    return null;
  }
}

/** Chat identity does not confer access to any Longboard product API. */
export async function requireChatUser(
  _req?: NextRequest,
  timing?: ChatServerTiming,
): Promise<ChatAuthResult> {
  const step = <T>(name: string, run: () => PromiseLike<T>): PromiseLike<T> =>
    timing ? timing.time(name, run) : run();
  // CHAT-API: a Bearer token never falls back to the browser's sign-in.
  const apiToken = bearerChatApiToken((await headers()).get("authorization"));
  if (apiToken !== undefined) return apiTokenUser(apiToken, _req, step);
  const lb = await step("auth_user", () => longboardSignIn());
  const admin = createChatAdminClient();
  if (!admin) return { ok: false, status: 503, error: "chat_unavailable" };
  if (lb) {
    // Profile, chat account (created on a first visit), Boardroom tag and ShortScout copy in one call.
    const context = await step("auth_context", () =>
      readRequestContext.longboard(admin, lb.user, lb.session),
    );
    if (context.mode === "unavailable") return { ok: false, status: 503, error: "chat_unavailable" };
    if (context.mode === "ok") {
      const renewal = context.shortscout;
      if (renewal.invalid) return { ok: false, status: 401, error: "unauthenticated" };
      // An overdue copy denies SS only; independently verified Longboard access remains.
      return {
        ok: true,
        user: context.user,
        access: {
          boardroom: context.boardroom,
          longboard: true,
          ...shortscoutChatEntitlements(renewal.identity?.membership_level),
          admin: context.user.role === "admin",
          ...withMember(context.member),
        },
        serverSession: false,
        hasSeparateShortScoutProfile: renewal.bridged,
        ...bridgedSource(renewal),
      };
    }
    // A signed-out session or a missing profile falls through to a chat sign-in, as before.
  }
  const token = (await cookies()).get(CHAT_SESSION_COOKIE)?.value;
  if (!validChatLoginSecret(token)) return { ok: false, status: 401, error: "unauthenticated" };
  const context = await step("auth_session", () => readRequestContext.session(admin, chatSecretHash(token)));
  if (context.mode === "unavailable") return { ok: false, status: 503, error: "chat_unavailable" };
  if (context.mode !== "ok") return { ok: false, status: 401, error: "unauthenticated" };
  const renewal = context.shortscout;
  const member = withMember(context.member);
  // #384: a club sign-in (member_open_chat_session) has no ShortScout identity at all: its
  // purchases are its access. It gets only what they unlock: no Longboard, ShortScout or admin.
  const clubOnly = !renewal.invalid && !renewal.unavailable && !renewal.bridged && !renewal.identity;
  if (clubOnly && "member" in member && !context.longboard)
    return {
      ok: true,
      user: { id: context.account, email: "", role: "user" },
      access: {
        boardroom: false,
        longboard: false,
        shortscout: false,
        shortscoutMember: false,
        admin: false,
        ...member,
      },
      serverSession: true,
    };
  if (renewal.unavailable) return { ok: false, status: 503, error: "chat_unavailable" };
  const identity = renewal.identity;
  if (renewal.invalid || !identity || !isPaidShortScoutLevel(identity.membership_level))
    return { ok: false, status: 401, error: "unauthenticated" };
  const role = sessionRole(context);
  return {
    ok: true,
    user: { id: context.account, email: "", role },
    access: {
      boardroom: context.longboard && context.boardroom,
      longboard: context.longboard,
      ...shortscoutChatEntitlements(identity.membership_level),
      admin: role === "admin",
      ...member,
    },
    serverSession: true,
    hasSeparateShortScoutProfile: renewal.bridged,
    ...bridgedSource(renewal),
  };
}

async function apiTokenUser(
  token: string | null,
  req: NextRequest | undefined,
  step: <T>(name: string, run: () => PromiseLike<T>) => PromiseLike<T>,
): Promise<ChatAuthResult> {
  if (!token) return { ok: false, status: 401, error: "invalid_token" };
  if (!chatApiRouteAllowed(req?.nextUrl?.pathname))
    return { ok: false, status: 403, error: "not_available_with_api_token" };
  const admin = createChatAdminClient();
  if (!admin) return { ok: false, status: 503, error: "chat_unavailable" };
  const { data, error } = await step("auth_api_token", () =>
    admin
      .rpc("chat_api_request_context", { p_token_hash: chatSecretHash(token) })
      .abortSignal(AbortSignal.timeout(5000)),
  );
  if (error || !data) return { ok: false, status: 503, error: "chat_unavailable" };
  // #450: not a personal token: maybe an agent's (a second call only for those, and bad tokens).
  if (data.mode === "unauthenticated") return agentTokenUser(admin, token, req, step);
  if (data.mode !== "ok") return { ok: false, status: 401, error: "invalid_token" };
  // #330: a bot account has only its listed rooms: never admin, Boardroom or ShortScout.
  if (Array.isArray(data.botRooms))
    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email, role: "user" },
      access: {
        boardroom: false,
        longboard: false,
        shortscout: false,
        shortscoutMember: false,
        admin: false,
        botRooms: data.botRooms.filter((room: unknown): room is string => typeof room === "string"),
      },
      serverSession: false,
      apiToken: true,
    };
  const renewal = shortScoutFromCopy(data.shortscout);
  if (renewal.invalid) return { ok: false, status: 401, error: "invalid_token" };
  const role = data.user.role === "admin" ? "admin" : "user";
  return {
    ok: true,
    user: { id: data.user.id, email: data.user.email, role },
    access: {
      boardroom: data.boardroom === true,
      longboard: true,
      ...shortscoutChatEntitlements(renewal.identity?.membership_level),
      admin: role === "admin",
      ...withMember(data.member),
    },
    serverSession: false,
    hasSeparateShortScoutProfile: renewal.bridged,
    apiToken: true,
  };
}

/**
 * #450: an agent token. It speaks for the agent's owner as a plain member (never admin), only in
 * the rooms the agent may read (owner's rooms, the ceiling and the agent's own settings), and only
 * on the agent routes. A paused agent is refused at once.
 */
async function agentTokenUser(
  admin: NonNullable<ReturnType<typeof createChatAdminClient>>,
  token: string,
  req: NextRequest | undefined,
  step: <T>(name: string, run: () => PromiseLike<T>) => PromiseLike<T>,
): Promise<ChatAuthResult> {
  const { data, error } = await step("auth_agent_token", () =>
    admin
      .rpc("chat_agent_request_context", { p_token_hash: chatSecretHash(token) })
      .abortSignal(AbortSignal.timeout(5000)),
  );
  // Before the agents migration there is no such function: the token is just unknown.
  if (error?.code === "PGRST202" || error?.code === "42883")
    return { ok: false, status: 401, error: "invalid_token" };
  if (error || !data) return { ok: false, status: 503, error: "chat_unavailable" };
  if (data.mode === "agent_paused") return { ok: false, status: 403, error: "agent_paused" };
  const agent = data.mode === "ok" ? parseAgentIdentity(data.agent) : null;
  if (!agent) return { ok: false, status: 401, error: "invalid_token" };
  if (!chatAgentRouteAllowed(req?.nextUrl?.pathname))
    return { ok: false, status: 403, error: "not_available_with_agent_token" };
  const renewal = shortScoutFromCopy(data.shortscout);
  if (renewal.invalid) return { ok: false, status: 401, error: "invalid_token" };
  const owner: ChatEntitlements = {
    boardroom: data.boardroom === true,
    longboard: true,
    ...shortscoutChatEntitlements(renewal.identity?.membership_level),
    admin: false,
    ...withMember(data.member),
  };
  return {
    ok: true,
    user: { id: data.user.id, email: data.user.email, role: "user" },
    access: {
      ...owner,
      botRooms: allowedChatRooms(owner).filter((room) => agent.readRooms.includes(room)),
    },
    serverSession: false,
    apiToken: true,
    agent,
  };
}
