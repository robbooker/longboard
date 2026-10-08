import { expect, it } from "vitest";
import { CHAT_AUTO_REFRESH_IDLE_MS, shouldAutoRefresh } from "@/lib/chatAutoRefresh";

const base = { readyVersion: "v2", attemptedVersion: null, hidden: false, returning: false, idleMs: 0, online: true };

it("never reloads a visible chat that is in use", () => {
  expect(shouldAutoRefresh(base)).toBe(false);
  expect(shouldAutoRefresh({ ...base, idleMs: CHAT_AUTO_REFRESH_IDLE_MS - 1 })).toBe(false);
});

it("reloads a background tab, a tab just returned to, or an idle one", () => {
  expect(shouldAutoRefresh({ ...base, hidden: true })).toBe(true);
  expect(shouldAutoRefresh({ ...base, returning: true })).toBe(true);
  expect(shouldAutoRefresh({ ...base, idleMs: CHAT_AUTO_REFRESH_IDLE_MS })).toBe(true);
});

it("needs a ready update and a connection, and tries each version once", () => {
  expect(shouldAutoRefresh({ ...base, hidden: true, readyVersion: null })).toBe(false);
  expect(shouldAutoRefresh({ ...base, hidden: true, online: false })).toBe(false);
  expect(shouldAutoRefresh({ ...base, hidden: true, attemptedVersion: "v2" })).toBe(false);
  expect(shouldAutoRefresh({ ...base, hidden: true, attemptedVersion: "v1" })).toBe(true);
});
