import { describe, expect, it } from "vitest";
import {
  canUseChatPages,
  HTTPS_ONLY_ERROR,
  pageSlug,
  parseHttpsUrl,
  parseLinkInput,
  parsePageInput,
  sortPageLinks,
  toggleLinkLike,
} from "@/lib/chatPages";

describe("parseHttpsUrl (#321)", () => {
  it.each([
    ["https://dashboard.robbooker.com", "https://dashboard.robbooker.com/"],
    ["  https://finviz.com/screener.ashx?v=111  ", "https://finviz.com/screener.ashx?v=111"],
    ["HTTPS://Example.com/Path", "https://example.com/Path"],
  ])("accepts %s", (input, out) => {
    expect(parseHttpsUrl(input)).toEqual({ ok: true, value: out });
  });
  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.com",
    "example.com",
    "//example.com",
    "mailto:a@b.com",
  ])("refuses non-https %s with the https message", (input) => {
    expect(parseHttpsUrl(input)).toEqual({ ok: false, error: HTTPS_ONLY_ERROR });
  });
  it.each([
    ["", "Add a web address."],
    [undefined, "Add a web address."],
    [42, "Add a web address."],
    ["https://exa mple.com", "A web address cannot contain spaces."],
    ["https://user:pw@example.com", "Remove the user name or password from the web address."],
    ["https://localhost:3000", "That doesn't look like a web address."],
    [`https://example.com/${"a".repeat(2100)}`, "That web address is too long."],
  ])("refuses %j", (input, error) => {
    expect(parseHttpsUrl(input)).toEqual({ ok: false, error });
  });
});

describe("parseLinkInput", () => {
  it("trims, collapses the note to one line and keeps an empty note null", () => {
    expect(parseLinkInput({ title: "  Finviz ", url: "https://finviz.com", note: " fast\nscreener " })).toEqual({
      ok: true,
      value: { title: "Finviz", url: "https://finviz.com/", note: "fast screener" },
    });
    expect(parseLinkInput({ title: "A", url: "https://a.com", note: "  " })).toMatchObject({ ok: true, value: { note: null } });
  });
  it("requires a title and limits lengths", () => {
    expect(parseLinkInput({ url: "https://a.com" })).toEqual({ ok: false, error: "Add a title." });
    expect(parseLinkInput({ title: "x".repeat(81), url: "https://a.com" }).ok).toBe(false);
    expect(parseLinkInput({ title: "x", url: "https://a.com", note: "n".repeat(141) }).ok).toBe(false);
    expect(parseLinkInput(null)).toEqual({ ok: false, error: "Add a title." });
  });
  it("refuses http", () => {
    expect(parseLinkInput({ title: "x", url: "http://a.com" })).toEqual({ ok: false, error: HTTPS_ONLY_ERROR });
  });
});

describe("parsePageInput", () => {
  it("accepts a list page and an https embed", () => {
    expect(parsePageInput({ name: "Brokers", kind: "links", embedUrl: "http://ignored" })).toEqual({
      ok: true,
      value: { name: "Brokers", kind: "links", embedUrl: null },
    });
    expect(parsePageInput({ name: "Calendar", kind: "embed", embedUrl: "https://cal.example.com" })).toEqual({
      ok: true,
      value: { name: "Calendar", kind: "embed", embedUrl: "https://cal.example.com/" },
    });
  });
  it("refuses http embeds, other kinds and the chat's own host", () => {
    expect(parsePageInput({ name: "X", kind: "embed", embedUrl: "http://a.com" })).toEqual({ ok: false, error: HTTPS_ONLY_ERROR });
    expect(parsePageInput({ name: "X", kind: "my-links" }).ok).toBe(false);
    expect(parsePageInput({ name: "", kind: "links" }).ok).toBe(false);
    expect(parsePageInput({ name: "Me", kind: "embed", embedUrl: "https://chat.robbooker.com/chat" }, ["chat.robbooker.com:443"]).ok).toBe(false);
  });
});

it("slugs, sorts pinned first and gates on chat membership", () => {
  expect(pageSlug("Broker Links!", "a1b2c3")).toBe("broker-links-a1b2c3");
  expect(pageSlug("!!!", "a1b2c3")).toBe("page-a1b2c3");
  const sorted = sortPageLinks([
    { id: "old", pinned: false, createdAt: "2026-01-01" },
    { id: "new", pinned: false, createdAt: "2026-02-01" },
    { id: "pin", pinned: true, createdAt: "2025-01-01" },
  ]);
  expect(sorted.map((link) => link.id)).toEqual(["pin", "new", "old"]);
  expect(canUseChatPages({ longboard: false, shortscout: false })).toBe(false);
  expect(canUseChatPages({ longboard: false, shortscout: false, shortscoutMember: true })).toBe(true);
  expect(canUseChatPages({ longboard: true, shortscout: false })).toBe(true);
});

describe("likes rank shared links (#323)", () => {
  const links = [
    { id: "old-3", pinned: false, likeCount: 3, createdAt: "2026-01-01" },
    { id: "new-0", pinned: false, likeCount: 0, createdAt: "2026-03-01" },
    { id: "mid-3", pinned: false, likeCount: 3, createdAt: "2026-02-01" },
    { id: "top-9", pinned: false, likeCount: 9, createdAt: "2025-06-01" },
    { id: "pin-old", pinned: true, likeCount: 0, createdAt: "2025-01-01" },
    { id: "pin-new", pinned: true, likeCount: 0, createdAt: "2025-05-01" },
  ];
  const ids = (list: Array<{ id: string }>) => list.map((link) => link.id);
  it("Top (the default): pinned first in their own order, then most likes, ties newest first", () => {
    expect(ids(sortPageLinks(links))).toEqual(["pin-new", "pin-old", "top-9", "mid-3", "old-3", "new-0"]);
    expect(ids(sortPageLinks(links, "top"))).toEqual(ids(sortPageLinks(links)));
  });
  it("pinned links with no likes stay above a link with many", () => {
    const pinnedWithLikes = links.map((link) => (link.id === "pin-old" ? { ...link, likeCount: 50 } : link));
    expect(ids(sortPageLinks(pinnedWithLikes)).slice(0, 3)).toEqual(["pin-new", "pin-old", "top-9"]);
  });
  it("New: pinned first, then newest first whatever the likes", () => {
    expect(ids(sortPageLinks(links, "new"))).toEqual(["pin-new", "pin-old", "new-0", "mid-3", "old-3", "top-9"]);
  });
  it("a like moves a link up once it passes the one above", () => {
    const list = [
      { id: "a", pinned: false, likeCount: 2, likedByMe: false, createdAt: "2026-01-01" },
      { id: "b", pinned: false, likeCount: 1, likedByMe: false, createdAt: "2026-02-01" },
    ];
    const once = list.map((link) => (link.id === "b" ? toggleLinkLike(link, true) : link));
    // 2 vs 2: a tie goes to the newer link.
    expect(ids(sortPageLinks(once))).toEqual(["b", "a"]);
    const back = once.map((link) => (link.id === "b" ? toggleLinkLike(link, false) : link));
    expect(ids(sortPageLinks(back))).toEqual(["a", "b"]);
  });
  it("toggleLinkLike counts one like per member and never goes below zero", () => {
    const link = { likeCount: 0, likedByMe: false };
    expect(toggleLinkLike(link, true)).toEqual({ likeCount: 1, likedByMe: true });
    expect(toggleLinkLike(toggleLinkLike(link, true), true)).toEqual({ likeCount: 1, likedByMe: true });
    expect(toggleLinkLike(link, false)).toBe(link);
    expect(toggleLinkLike({ likeCount: 0, likedByMe: true }, false)).toEqual({ likeCount: 0, likedByMe: false });
  });
});
