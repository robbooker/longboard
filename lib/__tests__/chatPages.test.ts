import { describe, expect, it } from "vitest";
import {
  canUseChatPages,
  HTTPS_ONLY_ERROR,
  pageSlug,
  parseHttpsUrl,
  parseLinkInput,
  parsePageInput,
  sortPageLinks,
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
