// #386 Booker Stock Club: who gets the room, Rob's country weighting, when a post goes up, the text.
import { describe, expect, it } from "vitest";
import { allowedChatRooms, canAccessChatRoom, canWriteChatRoom, clubRoomAccess, type ChatEntitlements } from "@/lib/chatAccess";
import { roomRepliesOff } from "@/lib/publicChat";
import { cardLevels, decidePost, isPriorityCountry, pickBody, rankCandidates, type ClubPick } from "@/lib/stockClub";

const member = (access: Partial<ChatEntitlements>): ChatEntitlements => ({ longboard: false, shortscout: false, admin: false, ...access });

describe("access: the club-room entitlement, or the Gainers rule", () => {
  it.each([
    ["Longboard member", member({ longboard: true })],
    ["ShortScout mastermind", member({ shortscout: true })],
    ["ShortScout paid member", member({ shortscoutMember: true })],
    ["admin", member({ longboard: true, admin: true })],
  ])("%s has the room, like Gainers", (_name, access) => {
    expect(clubRoomAccess(access)).toBe(true);
    expect(canAccessChatRoom(access, "club")).toBe(canAccessChatRoom(access, "gainers"));
    expect(allowedChatRooms(access)).toContain("club");
  });
  it("#384: a club-room entitlement opens it without Gainers; a gainers entitlement opens both", () => {
    const club = member({ member: ["club-room"] });
    expect(clubRoomAccess(club)).toBe(true);
    expect(allowedChatRooms(club)).toEqual(["club"]);
    expect(allowedChatRooms(member({ member: ["gainers"] }))).toEqual(["gainers", "club"]);
    expect(clubRoomAccess(member({ member: ["reader"] }))).toBe(false);
  });
  it("a bot never gets it from entitlements", () => {
    expect(clubRoomAccess(member({ member: ["club-room"], botRooms: ["lb-review"] }))).toBe(false);
    expect(allowedChatRooms(member({ member: ["club-room"], botRooms: ["lb-review"] }))).toEqual(["lb-review"]);
  });
  it("nobody else, and a bot only when its list names the room", () => {
    expect(clubRoomAccess(member({}))).toBe(false);
    expect(allowedChatRooms(member({}))).not.toContain("club");
    expect(allowedChatRooms(member({ longboard: true, botRooms: ["lb-review"] }))).not.toContain("club");
  });
  it("is read-only for everyone, admins too, with no replies", () => {
    expect(canWriteChatRoom(member({ longboard: true }), "club")).toBe(false);
    expect(canWriteChatRoom(member({ longboard: true, admin: true }), "club")).toBe(false);
    expect(roomRepliesOff("club")).toBe(true);
  });
});

describe("country weighting", () => {
  it("China, Hong Kong, Malaysia and Singapore count, as DilutionTracker writes them", () => {
    for (const c of ["China", "Hong Kong", "China Hong Kong", "Malaysia", "Singapore", "singapore"]) expect(isPriorityCountry(c)).toBe(true);
    for (const c of ["U.S.", "Canada", "Taiwan", "Israel", "", null, undefined]) expect(isPriorityCountry(c)).toBe(false);
  });
  const candidates = [
    { ticker: "USAA", changePct: 180 },
    { ticker: "MYAA", changePct: 45 },
    { ticker: "CNAA", changePct: 90 },
    { ticker: "UNKN", changePct: 300 },
    { ticker: "HKAA", changePct: 120 },
  ];
  it("the four rank first by % gain among themselves, then the rest by % gain", () => {
    const countries = new Map<string, string | null>([["USAA", "U.S."], ["MYAA", "Malaysia"], ["CNAA", "China"], ["HKAA", "China Hong Kong"]]);
    expect(rankCandidates(candidates, countries).map((c) => c.ticker)).toEqual(["HKAA", "CNAA", "MYAA", "UNKN", "USAA"]);
  });
  it("an unknown country is not Asian until the lookup finds it", () => {
    const before = new Map<string, string | null>([["USAA", "U.S."]]);
    expect(rankCandidates(candidates, before)[0].ticker).toBe("UNKN");
    const after = new Map<string, string | null>([...before, ["UNKN", "Singapore"]]);
    expect(rankCandidates(candidates, after)[0].ticker).toBe("UNKN");
    const later = new Map<string, string | null>([...before, ["UNKN", "Canada"], ["MYAA", "Malaysia"]]);
    expect(rankCandidates(candidates, later).map((c) => c.ticker)).toEqual(["MYAA", "UNKN", "USAA", "HKAA", "CNAA"]);
  });
  it("a non-Asian stock is #1 only when none of the four qualify", () => {
    expect(rankCandidates([{ ticker: "USAA", changePct: 500 }, { ticker: "SGAA", changePct: 31 }], new Map([["SGAA", "Singapore"], ["USAA", "U.S."]]))[0].ticker).toBe("SGAA");
    expect(rankCandidates([{ ticker: "USAA", changePct: 50 }, { ticker: "CAAA", changePct: 60 }], new Map())[0].ticker).toBe("CAAA");
  });
  it("leaves the input alone", () => {
    const copy = [...candidates];
    rankCandidates(candidates, new Map());
    expect(candidates).toEqual(copy);
  });
});

describe("when a post goes up", () => {
  it("the first #1 of the day posts", () => expect(decidePost({ locked: false, posted: [] }, "AAAA")).toBe("post"));
  it("the same #1 again never posts", () => expect(decidePost({ locked: false, posted: ["AAAA"] }, "AAAA")).toBe("same"));
  it("a new #1 posts", () => expect(decidePost({ locked: false, posted: ["AAAA"] }, "BBBB")).toBe("post"));
  it("a #1 that swings back is not posted twice", () => expect(decidePost({ locked: false, posted: ["AAAA", "BBBB"] }, "AAAA")).toBe("already_posted"));
  it("no candidates, no post", () => expect(decidePost({ locked: false, posted: [] }, null)).toBe("none"));
  it("an admin's pick stops automatic changes for the day", () => expect(decidePost({ locked: true, posted: ["ADMN"] }, "BBBB")).toBe("locked"));
});

const pick: ClubPick = {
  ticker: "AAAA",
  name: "Alpha Holdings",
  day: "2026-11-06",
  at: "2026-11-06T15:00:00Z",
  source: "auto",
  price: 3.42,
  changePct: 87.25,
  volume: 12_345_678,
  marketCap: 24_000_000,
  country: "China",
  instOwnPct: 4.25,
  borrow: { status: "offered", etb: false, pricePerShare: 0.04, locateType: "Locate", checkedAt: "2026-11-06T14:58:00Z", attemptedAt: "2026-11-06T14:58:00Z" },
  levels: [
    { kind: "missed", price: 4.657, label: "Missed pivot · Aug 26" },
    { kind: "sma200", price: 6.1, label: "Daily 200 SMA" },
  ],
  chart: null,
};

describe("the post's text", () => {
  it("names every field", () => {
    expect(pickBody(pick)).toBe(
      [
        "#1 stock of the day: AAAA (Alpha Holdings)",
        "$3.42 · +87.3% today · Volume 12.3M",
        "Country: China · Inst own: 4.3% · Borrow at TZ: $0.04",
        "Levels above: $4.66 Missed pivot · Aug 26 · $6.10 Daily 200 SMA",
      ].join("\n"),
    );
  });
  it("says what isn't known yet", () => {
    const body = pickBody({ ...pick, source: "admin", name: "", country: null, instOwnPct: null, borrow: null, levels: [] });
    expect(body).toContain("Today's pick: AAAA\n");
    expect(body).toContain("Country: looking up… · Inst own: — · Borrow at TZ: checking…");
    expect(body).toContain("Levels above: none");
  });
});

describe("which levels a card lists", () => {
  it("the CMP and 200 SMA always, then the nearest missed pivots, six at most, nearest first", () => {
    const missed = Array.from({ length: 9 }, (_, i) => ({ kind: "missed" as const, price: 3 + i, label: `m${i}` }));
    const levels = [...missed, { kind: "cmp" as const, price: 3.5, label: "cmp" }, { kind: "sma200" as const, price: 20, label: "sma" }].sort((a, b) => a.price - b.price);
    expect(cardLevels(levels).map((l) => l.price)).toEqual([3, 3.5, 4, 5, 6, 20]);
    expect(cardLevels(missed.slice(0, 2)).map((l) => l.price)).toEqual([3, 4]);
  });
});
