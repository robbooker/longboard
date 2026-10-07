import { expect, it } from "vitest";
import { ChatServerTiming } from "@/lib/chatServerTiming";

it("records each step, including failures, as a valid Server-Timing header", async () => {
  const timing = new ChatServerTiming();
  expect(await timing.time("auth_user", async () => 7)).toBe(7);
  await expect(timing.time("read history", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  timing.record("total", 12.345);
  expect(timing.header()).toMatch(/^auth_user;dur=\d+\.\d, read_history;dur=\d+\.\d, total;dur=12\.3$/);
});
