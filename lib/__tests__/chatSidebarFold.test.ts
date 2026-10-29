import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SIDEBAR_FOLD_GROUPS,
  SIDEBAR_FOLD_PREFIX,
  countOf,
  foldedRoomTotals,
  isSidebarFoldGroup,
  parseSidebarFolds,
  roomHasMention,
  sidebarFoldKey,
  sumCounts,
  toggleSidebarFold,
} from "@/lib/chatSidebarFold";
import { FoldHeading } from "@/components/chat/SidebarFold";
import { roomBadgeCounts } from "@/lib/chatRoomNotify";

// D-324: folding sidebar groups. The fold state helper and what a folded heading adds up.
describe("fold state", () => {
  it("starts with nothing folded and reads junk as nothing folded", () => {
    for (const raw of [null, undefined, "", "not json", "{}", '"rooms"', "42", "null"])
      expect(parseSidebarFolds(raw)).toEqual([]);
  });
  it("keeps only known groups, in a fixed order, once each", () => {
    expect(parseSidebarFolds('["dms","nope","rooms","rooms",3]')).toEqual(["rooms", "dms"]);
    expect(SIDEBAR_FOLD_GROUPS).toEqual(["pinned", "rooms", "announcements", "recordings", "pages", "dms"]);
    expect(isSidebarFoldGroup("announcements")).toBe(true);
    expect(isSidebarFoldGroup("whats-new")).toBe(false);
  });
  it("folds and unfolds one group without touching the others", () => {
    let raw = toggleSidebarFold("", "announcements", true);
    expect(parseSidebarFolds(raw)).toEqual(["announcements"]);
    raw = toggleSidebarFold(raw, "dms", true);
    raw = toggleSidebarFold(raw, "rooms", true);
    expect(raw).toBe('["rooms","announcements","dms"]');
    expect(toggleSidebarFold(raw, "rooms", true)).toBe(raw);
    raw = toggleSidebarFold(raw, "announcements", false);
    expect(parseSidebarFolds(raw)).toEqual(["rooms", "dms"]);
    expect(toggleSidebarFold("garbage", "pages", true)).toBe('["pages"]');
  });
  it("keeps each person's folds under their own key", () => {
    expect(sidebarFoldKey("a")).not.toBe(sidebarFoldKey("b"));
    expect(sidebarFoldKey(null)).toBe(sidebarFoldKey(undefined));
    expect(sidebarFoldKey("a").startsWith(SIDEBAR_FOLD_PREFIX)).toBe(true);
  });
});

describe("folded group totals", () => {
  const announcements = ["lb-announcements", "ss-announcements"] as const;
  it("adds the unread counts of every room in the group", () => {
    expect(foldedRoomTotals(announcements, { "lb-announcements": 2, "ss-announcements": 3, main: 9 }, {})).toEqual({
      unread: 5,
      mention: false,
    });
  });
  it("shows zero and no mention when everything is read or counts are missing", () => {
    expect(foldedRoomTotals(announcements, undefined, undefined)).toEqual({ unread: 0, mention: false });
    expect(foldedRoomTotals(announcements, { "lb-announcements": 0 }, { "lb-announcements": 0 })).toEqual({
      unread: 0,
      mention: false,
    });
  });
  it("marks a mention when any room in the group has an unread mention among unread messages", () => {
    const rooms = ["main", "social", "shortscout"] as const;
    expect(foldedRoomTotals(rooms, { main: 4, social: 1 }, { social: 1 })).toEqual({ unread: 5, mention: true });
    expect(foldedRoomTotals(rooms, { main: 4 }, { gainers: 2 })).toEqual({ unread: 4, mention: false });
  });
  it("drops the mark once the room is read, even while the bell entry is unread", () => {
    expect(foldedRoomTotals(["main", "social"], { main: 2, social: 0 }, { social: 1 })).toEqual({
      unread: 2,
      mention: false,
    });
    expect(roomHasMention("social", { social: 0 }, { social: 3 })).toBe(false);
  });
  it("never marks an announcement or recording post as a mention, but counts it", () => {
    expect(foldedRoomTotals(announcements, { "lb-announcements": 2 }, { "lb-announcements": 2 })).toEqual({
      unread: 2,
      mention: false,
    });
    expect(roomHasMention("lb-recordings", { "lb-recordings": 1 }, { "lb-recordings": 1 })).toBe(false);
    expect(roomHasMention("whats-new", { "whats-new": 1 }, { "whats-new": 1 })).toBe(false);
  });
  it("skips rooms the person can't open", () => {
    expect(
      foldedRoomTotals(["main", "social"], { main: 2, social: 3 }, { social: 1 }, [
        "main",
      ]),
    ).toEqual({ unread: 2, mention: false });
  });
  it("follows the room badges: a muted room adds nothing, a mentions-only room adds only mentions", () => {
    const badges = roomBadgeCounts({
      roomMessageCounts: { main: 10, social: 4, shortscout: 3 },
      roomCounts: { social: 1 },
      roomLevels: { main: "muted", social: "mentions" },
    });
    expect(foldedRoomTotals(["main", "social", "shortscout"], badges, { social: 1 })).toEqual({
      unread: 4,
      mention: true,
    });
  });
  it("ignores counts that aren't whole positive numbers", () => {
    expect(countOf(-1)).toBe(0);
    expect(countOf(1.5)).toBe(0);
    expect(countOf("3")).toBe(0);
    expect(countOf(Number.NaN)).toBe(0);
    expect(sumCounts([1, undefined, 2, -4, "x", 3])).toBe(6);
  });
});

describe("fold heading", () => {
  const render = (props: Partial<Parameters<typeof FoldHeading>[0]>) =>
    renderToStaticMarkup(
      createElement(FoldHeading, {
        group: "announcements",
        label: "Announcements",
        folded: false,
        onToggle: () => {},
        ...props,
      }),
    );
  it("is a button that says whether the group is open", () => {
    const open = render({ unread: 3, mention: true });
    expect(open).toMatch(/^<button type="button"/);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('data-sidebar-fold="announcements"');
    // Open, the rooms show their own counts; the heading adds none.
    expect(open).not.toContain("data-fold-unread");
    expect(open).not.toContain("data-fold-mention");
  });
  it("folded, it shows the group's unread total and the mention mark", () => {
    const folded = render({ folded: true, unread: 5, mention: true });
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toContain('data-fold-unread="5"');
    expect(folded).toContain('data-fold-mention="true"');
    expect(render({ folded: true, unread: 120 })).toContain(">99+<");
    expect(render({ folded: true })).not.toContain("data-fold-unread");
  });
});
