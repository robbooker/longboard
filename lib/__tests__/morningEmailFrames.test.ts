import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("#518 stored morning emails cannot run scripts", () => {
  it.each(["app/admin/morning-email/history/HistoryClient.tsx", "app/admin/morning-email/MorningEmailClient.tsx"])("%s shows the email in a locked-down frame", (file) => {
    const source = readFileSync(join(__dirname, "../..", file), "utf8");
    const frames = source.match(/<iframe[\s\S]*?\/>/g) ?? [];
    expect(frames.length).toBe(1);
    expect(frames[0]).toContain("srcDoc=");
    expect(frames[0]).toMatch(/\bsandbox=""/);
  });
});
