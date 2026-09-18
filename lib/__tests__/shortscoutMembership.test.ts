import { describe, it, expect, vi } from "vitest";
import { verifyShortScoutMembership } from "@/lib/shortscoutMembership";
const subject = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
function fixture(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
describe("ShortScout scoped membership verifier", () => {
  it.each(["monthly", "annual", "lifetime", "mastermind"])("accepts verified %s", async level => {
    const request = fixture({ allowed: true, userId: subject, membershipLevel: level });
    expect(await verifyShortScoutMembership("user-token", request)).toEqual({ ok: true, subject, level });
    expect(request).toHaveBeenCalledWith("https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-auth-bridge", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer user-token" }, cache: "no-store", redirect: "error",
    }));
  });
  it.each([401, 403, 500, 503])("fails closed on HTTP %s", async status => {
    expect(await verifyShortScoutMembership("token", fixture({ allowed: true, userId: subject, membershipLevel: "mastermind" }, status)))
      .toEqual({ ok: false, reason: status === 401 ? "invalid_session" : "unavailable" });
  });
  it.each([
    { ok: true, mode: "service" },
    { allowed: true, userId: subject, membershipLevel: "free" },
    { allowed: true, userId: subject, membershipLevel: "unknown" },
    { allowed: true, userId: "", membershipLevel: "mastermind" },
    { allowed: false, userId: subject, membershipLevel: "mastermind" }, null,
  ])("rejects invalid success payload %j", async body => {
    expect((await verifyShortScoutMembership("token", fixture(body))).ok).toBe(false);
  });
  it("fails closed on network errors without disclosing diagnostics", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("private diagnostic"));
    expect(await verifyShortScoutMembership("token", request)).toEqual({ ok: false, reason: "unavailable" });
  });
  it.each(["", "bad\ntoken", "x".repeat(16385)])("rejects malformed tokens before making a request", async token => {
    const request = fixture({});
    expect((await verifyShortScoutMembership(token, request)).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

it.each([['email_not_confirmed','email_not_confirmed'],['membership_required','insufficient_membership'],['insufficient_membership','insufficient_membership'],['other_error','unavailable']])('preserves safe 403 distinction for %s',async(code,reason)=>{expect(await verifyShortScoutMembership('token',fixture({allowed:false,error:code},403))).toEqual({ok:false,reason});});
