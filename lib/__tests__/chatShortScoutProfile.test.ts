import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortScoutProfileState } from "@/lib/chatShortScoutProfile";
import type { ChatAuthResult } from "@/lib/chatAuth";

// #444: a linked ShortScout account with no profile of its own means the two were merged.
function admin(result: { data: unknown; error: unknown }, seen: string[] = []) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: string) => (seen.push(`${column}=${value}`), chain),
    maybeSingle: async () => result,
  };
  return { from: (table: string) => (seen.push(table), chain) } as unknown as SupabaseClient;
}
const auth = (extra: Partial<Extract<ChatAuthResult, { ok: true }>>): ChatAuthResult => ({
  ok: true,
  user: { id: "lb", email: "", role: "user" },
  access: { longboard: true, shortscout: true, admin: false },
  serverSession: false,
  ...extra,
});

describe("shortScoutProfileState", () => {
  it("is null without a linked membership", async () => {
    expect(await shortScoutProfileState(admin({ data: null, error: null }), auth({}))).toBeNull();
    expect(await shortScoutProfileState(admin({ data: null, error: null }), { ok: false, status: 401, error: "x" })).toBeNull();
  });
  it("is merged when the ShortScout account has no profile", async () => {
    const seen: string[] = [];
    expect(
      await shortScoutProfileState(
        admin({ data: null, error: null }, seen),
        auth({ hasSeparateShortScoutProfile: true, shortScoutSourceAccountId: "ss" }),
      ),
    ).toBe("merged");
    expect(seen).toEqual(["longboard_chat_members", "user_id=ss"]);
  });
  it("is separate while the ShortScout profile exists, or when it can't tell", async () => {
    const linked = auth({ hasSeparateShortScoutProfile: true, shortScoutSourceAccountId: "ss" });
    expect(await shortScoutProfileState(admin({ data: { id: "m" }, error: null }), linked)).toBe("separate");
    expect(await shortScoutProfileState(admin({ data: null, error: { message: "down" } }), linked)).toBe("separate");
    expect(await shortScoutProfileState(null, linked)).toBe("separate");
    expect(await shortScoutProfileState(admin({ data: null, error: null }), auth({ hasSeparateShortScoutProfile: true }))).toBe("separate");
  });
});
