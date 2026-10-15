import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/chat/manifest.webmanifest/route";

describe("chat web manifest", () => {
  it("is installable as a standalone app scoped to /chat", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    const m = await res.json();
    expect(m).toMatchObject({ id: "/chat", start_url: "/chat", scope: "/chat", display: "standalone", name: "Rob Booker Chat", short_name: "RB Chat" });
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    for (const purpose of ["any", "maskable"]) {
      const sizes = m.icons.filter((i: { purpose: string }) => i.purpose === purpose).map((i: { sizes: string }) => i.sizes);
      expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    }
    for (const icon of m.icons) expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
  });
});
