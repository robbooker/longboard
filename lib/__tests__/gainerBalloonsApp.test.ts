import { describe, expect, it, vi } from "vitest";

// #528 Gainer Balloons as an app: who has it in the sidebar's Apps section, and that it can be put
// on a Dual or Quad pane and a Six card (the same registry the Reader uses).
vi.mock("@/lib/readerAccess", () => ({ canUseReader: async () => false }));
import { CHAT_APPS, chatAppsIn, isChatAppId } from "@/lib/chatApps";
import { chatAppsFor } from "@/lib/chatApps.server";
import { CARD_DEFINITIONS, validateCardLayout, type CardOptions } from "@/lib/chatCards";
import { quadChoices, validateQuadLayout } from "@/lib/chatQuad";

const who = (access: Record<string, unknown>) => ({ user: { id: "a" }, access: { longboard: false, shortscout: false, admin: false, ...access } });

describe("Gainer Balloons in Apps", () => {
  it("is an app with its own page address", () => {
    expect(isChatAppId("balloons")).toBe(true);
    expect(chatAppsIn(["balloons"])).toEqual([expect.objectContaining({ id: "balloons", label: "Gainer Balloons", initials: "GB" })]);
    // No trading words, and nothing about where data comes from, in what members read.
    for (const app of CHAT_APPS.filter((a) => a.id === "balloons")) expect(`${app.label} ${app.description}`).not.toMatch(/buy|sell|pump|source|polygon/i);
  });
  it("is given to exactly the members who can open the Gainers room", async () => {
    expect(await chatAppsFor(who({ longboard: true, boardroom: true }))).toEqual(["balloons"]);
    expect(await chatAppsFor(who({ shortscout: true }))).toEqual(["balloons"]);
    expect(await chatAppsFor(who({ member: ["gainers"] }))).toEqual(["balloons"]);
    // Not: an entitlement without Gainers, someone with no access, a bot (even one in the room list of a member).
    expect(await chatAppsFor(who({ member: ["reader"] }))).toEqual([]);
    expect(await chatAppsFor(who({}))).toEqual([]);
    expect(await chatAppsFor(who({ longboard: true, botRooms: ["social"] }))).toEqual([]);
  });
  it("can be chosen for a Dual or Quad pane and a Six card, once per view", () => {
    const choices = quadChoices(["main"], [], ["balloons"]);
    expect(choices.map((c) => c.key)).toEqual(["room:main", "app:balloons"]);
    expect(validateQuadLayout(["room:main", "app:balloons"], choices, 2)).toEqual(["room:main", "app:balloons"]);
    expect(validateQuadLayout(["app:balloons", "app:balloons", "", ""], choices, 4)).toEqual(["app:balloons", "", "", ""]);
    // Without the app, a saved pane is emptied.
    expect(validateQuadLayout(["app:balloons", "room:main"], quadChoices(["main"], [], []), 2)).toEqual(["", "room:main"]);

    const options: CardOptions = { rooms: ["main"], conversations: [], gainersTable: true, apps: ["balloons"] };
    expect(CARD_DEFINITIONS.app.sources(options)).toEqual([{ source: "balloons", label: "Gainer Balloons" }]);
    const card = { type: "app" as const, source: "balloons" };
    expect(validateCardLayout([card, card, null, null, null, null], options)).toEqual([card, null, null, null, null, null]);
    expect(validateCardLayout([card], { ...options, apps: [] })[0]).toBeNull();
  });
});
