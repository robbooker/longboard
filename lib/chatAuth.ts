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
export type ChatAuthResult =
  | {
      ok: true;
      user: { id: string; email: string; role: "user" | "admin" };
      access: ChatEntitlements;
      serverSession: boolean;
      hasSeparateShortScoutProfile?: boolean;
      /** CHAT-API: the request carried a personal API token instead of a browser sign-in. */
      apiToken?: boolean;
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
    const context = await step("auth_context", () => readRequestContext.longboard(admin, lb.user, lb.session));
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
        },
        serverSession: false,
        hasSeparateShortScoutProfile: renewal.bridged,
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
  if (renewal.unavailable) return { ok: false, status: 503, error: "chat_unavailable" };
  const identity = renewal.identity;
  if (renewal.invalid || !identity || !isPaidShortScoutLevel(identity.membership_level))
    return { ok: false, status: 401, error: "unauthenticated" };
  return {
    ok: true,
    user: { id: context.account, email: "", role: "user" },
    access: {
      boardroom: context.longboard && context.boardroom,
      longboard: context.longboard,
      ...shortscoutChatEntitlements(identity.membership_level),
      // This grants public-room access only; cookie sessions retain the user role.
      admin: context.role === "admin",
    },
    serverSession: true,
    hasSeparateShortScoutProfile: renewal.bridged,
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
    admin.rpc("chat_api_request_context", { p_token_hash: chatSecretHash(token) }).abortSignal(AbortSignal.timeout(5000)),
  );
  if (error || !data) return { ok: false, status: 503, error: "chat_unavailable" };
  if (data.mode !== "ok") return { ok: false, status: 401, error: "invalid_token" };
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
    },
    serverSession: false,
    hasSeparateShortScoutProfile: renewal.bridged,
    apiToken: true,
  };
}
