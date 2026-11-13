import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { developerLinkAllowed, developerLinkCandidate, hasDeveloperAccess } from "@/lib/chatDeveloperAccess";
import type { ChatAuthResult } from "@/lib/chatAuth";

// #454: the sidebar's Developers link shows only when the database says this account has developer access.
const ID = "11111111-1111-4111-8111-111111111111";
function admin(result: { data: unknown; error: unknown } | Error, seen: unknown[] = []) {
  return {
    rpc: async (fn: string, args: unknown) => {
      seen.push([fn, args]);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as SupabaseClient;
}
const auth = (extra: Partial<Extract<ChatAuthResult, { ok: true }>> = {}): ChatAuthResult => ({
  ok: true,
  user: { id: ID, email: "", role: "user" },
  access: { longboard: true, shortscout: false, admin: false },
  serverSession: false,
  ...extra,
});

describe("developerLinkAllowed", () => {
  it("shows only for an explicit access: true", () => {
    expect(developerLinkAllowed({ access: true, tokens: [] })).toBe(true);
    for (const answer of [{ access: false, tokens: [] }, { access: "true" }, { tokens: [] }, null, undefined, true, "access"])
      expect(developerLinkAllowed(answer)).toBe(false);
  });
});

describe("developerLinkCandidate", () => {
  it("is a browser sign-in only", () => {
    expect(developerLinkCandidate(auth())).toBe(true);
    expect(developerLinkCandidate(auth({ serverSession: true }))).toBe(true);
    expect(developerLinkCandidate({ ok: false, status: 401, error: "unauthenticated" })).toBe(false);
    expect(developerLinkCandidate(auth({ access: { longboard: true, shortscout: false, admin: false, botRooms: ["developers"] } }))).toBe(false);
    expect(developerLinkCandidate(auth({ apiToken: true }))).toBe(false);
    expect(developerLinkCandidate(auth({ agent: {} as never }))).toBe(false);
  });
});

describe("hasDeveloperAccess", () => {
  it("asks the developers page's own access check, once, for this account", async () => {
    const seen: unknown[] = [];
    expect(await hasDeveloperAccess(admin({ data: { access: true, tokens: [] }, error: null }, seen), auth())).toBe(true);
    expect(seen).toEqual([["list_chat_api_tokens", { actor: ID }]]);
    expect(await hasDeveloperAccess(admin({ data: { access: false, tokens: [] }, error: null }), auth())).toBe(false);
  });
  it("hides on a failed read", async () => {
    expect(await hasDeveloperAccess(admin({ data: { access: true }, error: { message: "down" } }), auth())).toBe(false);
    expect(await hasDeveloperAccess(admin(new Error("network")), auth())).toBe(false);
    expect(await hasDeveloperAccess(null, auth())).toBe(false);
  });
  it("never asks for signed-out visitors, bots, agents or API tokens", async () => {
    const seen: unknown[] = [];
    const db = admin({ data: { access: true }, error: null }, seen);
    expect(await hasDeveloperAccess(db, { ok: false, status: 401, error: "unauthenticated" })).toBe(false);
    expect(await hasDeveloperAccess(db, auth({ apiToken: true }))).toBe(false);
    expect(await hasDeveloperAccess(db, auth({ agent: {} as never }))).toBe(false);
    expect(seen).toEqual([]);
  });
});
