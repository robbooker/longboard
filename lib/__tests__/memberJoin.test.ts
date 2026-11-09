import { describe, expect, it } from "vitest";
import { CHECKOUT_SESSION_RE, joinCodeHash, joinCodeMatches, newJoinCode } from "@/lib/members/join";

// #384: the club sign-up codes.
describe("join codes", () => {
  it("are six digits, stored only as a hash tied to their row", () => {
    for (let i = 0; i < 50; i++) expect(newJoinCode()).toMatch(/^\d{6}$/);
    const hash = joinCodeHash("row-1", "012345");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("012345");
    expect(joinCodeHash("row-2", "012345")).not.toBe(hash);
  });
  it("match only the exact code for that row", () => {
    const hash = joinCodeHash("row-1", "012345");
    expect(joinCodeMatches("row-1", "012345", hash)).toBe(true);
    expect(joinCodeMatches("row-1", " 012345 ", hash)).toBe(true);
    expect(joinCodeMatches("row-1", "012346", hash)).toBe(false);
    expect(joinCodeMatches("row-2", "012345", hash)).toBe(false);
    for (const bad of [12345, "12345", "1234567", "abcdef", null, undefined]) expect(joinCodeMatches("row-1", bad, hash)).toBe(false);
  });
  it("accept only Stripe checkout session ids in the link", () => {
    expect(CHECKOUT_SESSION_RE.test("cs_test_a1B2c3D4e5F6g7H8")).toBe(true);
    expect(CHECKOUT_SESSION_RE.test("cs_live_a1B2c3D4e5F6g7H8")).toBe(true);
    for (const bad of ["{CHECKOUT_SESSION_ID}", "cs_test_", "pi_test_a1B2c3D4e5F6", "cs_test_abc'--"]) expect(CHECKOUT_SESSION_RE.test(bad)).toBe(false);
  });
});
