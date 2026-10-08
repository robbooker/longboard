import { describe, expect, it } from "vitest";
import { trackAttachmentCheck, waitForAttachments } from "@/lib/chatAttachmentWaits";

function deferred() {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("waitForAttachments", () => {
  it("passes straight through ids with no running check", async () => {
    await expect(waitForAttachments(["unknown"])).resolves.toBeUndefined();
    await expect(waitForAttachments([])).resolves.toBeUndefined();
  });

  it("waits until every running check passes", async () => {
    const a = deferred(),
      b = deferred();
    trackAttachmentCheck("a", a.promise);
    trackAttachmentCheck("b", b.promise);
    let done = false;
    const wait = waitForAttachments(["a", "b", "ready-already"]).then(() => (done = true));
    a.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    b.resolve();
    await wait;
    expect(done).toBe(true);
  });

  it("rejects with the check's error and forgets finished checks", async () => {
    const c = deferred();
    trackAttachmentCheck("c", c.promise);
    const wait = waitForAttachments(["c"]);
    c.reject(Error("This file did not pass the check."));
    await expect(wait).rejects.toThrow("This file did not pass the check.");
    await expect(waitForAttachments(["c"])).resolves.toBeUndefined();
  });
});
