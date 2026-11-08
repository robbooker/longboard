import { describe, it, expect } from "vitest";
import {
  CARD_DEFINITIONS,
  CARD_TYPES,
  availableCardTypes,
  cardSource,
  defaultSixLayout,
  isCardLayoutShape,
  quadKeyToCard,
  validateCardLayout,
  type CardOptions,
} from "../chatCards";
import { CARD_COMPONENTS } from "@/components/chat/cards/cardComponents";
import type { DirectConversation } from "../chatDirectMessages";

const dm = {
  id: "22222222-2222-4222-8222-222222222220",
  otherId: "friend",
  otherName: "Friend",
  status: "accepted",
  blockedByMe: false,
  unavailable: false,
  system: false,
} as DirectConversation;
const blocked = { ...dm, id: "22222222-2222-4222-8222-222222222221", otherName: "Blocked", blockedByMe: true };
const options: CardOptions = { rooms: ["main", "gainers", "social"], conversations: [dm, blocked], gainersTable: true };

describe("card registry", () => {
  it("has a definition and a component for every card type", () => {
    for (const type of CARD_TYPES) {
      expect(CARD_DEFINITIONS[type].type).toBe(type);
      expect(CARD_DEFINITIONS[type].label).toBeTruthy();
      expect(typeof CARD_COMPONENTS[type].Body).toBe("function");
    }
    expect(Object.keys(CARD_DEFINITIONS).sort()).toEqual([...CARD_TYPES].sort());
  });
  it("offers only sources the member can reach", () => {
    expect(CARD_DEFINITIONS.room.sources(options).map((s) => s.source)).toEqual(["main", "social", "gainers"]);
    expect(CARD_DEFINITIONS.dm.sources(options)).toEqual([{ source: dm.id, label: "Friend", otherId: "friend" }]);
    expect(CARD_DEFINITIONS["gainers-table"].sources(options)).toEqual([{ source: "", label: "Gainers Table" }]);
    expect(CARD_DEFINITIONS["gainers-table"].sources({ ...options, gainersTable: false })).toEqual([]);
  });
  it("hides types with nothing to pick", () => {
    expect(availableCardTypes(options).map((d) => d.type)).toEqual(["room", "dm", "gainers-table"]);
    expect(availableCardTypes({ rooms: ["social"], conversations: [], gainersTable: false }).map((d) => d.type)).toEqual(["room"]);
  });
  it("labels a card from its source, or null once access is gone", () => {
    expect(cardSource({ type: "room", source: "main" }, options)?.label).toBe("LB");
    expect(cardSource({ type: "room", source: "shortscout" }, options)).toBeNull();
  });
});

describe("six layout validation", () => {
  it("keeps valid cards in place and always returns six slots", () => {
    const layout = [
      { type: "room", source: "main" },
      { type: "dm", source: dm.id },
      null,
      { type: "gainers-table", source: "" },
    ];
    expect(validateCardLayout(layout, options)).toEqual([...layout, null, null]);
  });
  it("empties unknown types, unreachable sources, blocked DMs and repeats in place", () => {
    expect(
      validateCardLayout(
        [
          { type: "room", source: "shortscout" },
          { type: "chart", source: "AAPL" },
          { type: "dm", source: blocked.id },
          { type: "dm", source: "33333333-3333-4333-8333-333333333333" },
          { type: "room", source: "main" },
          { type: "room", source: "main" },
        ],
        options,
      ),
    ).toEqual([null, null, null, null, { type: "room", source: "main" }, null]);
  });
  it("gives the Gainers Table only to members who can see Gainers, once", () => {
    const table = { type: "gainers-table", source: "" };
    expect(validateCardLayout([table], { ...options, gainersTable: false })[0]).toBeNull();
    expect(validateCardLayout([table, table], options).slice(0, 2)).toEqual([table, null]);
    expect(validateCardLayout([{ type: "gainers-table", source: "x" }], options)[0]).toBeNull();
  });
  it("survives corrupt saved data", () => {
    for (const bad of [null, undefined, {}, 1, "room:main", [1, "x", [], { type: "room" }]])
      expect(validateCardLayout(bad, options)).toEqual([null, null, null, null, null, null]);
    expect(validateCardLayout(Array(10).fill(null).concat([{ type: "room", source: "main" }]), options)).toHaveLength(6);
  });
  it("rejects malformed request bodies before checking access", () => {
    expect(isCardLayoutShape([{ type: "room", source: "main" }, null])).toBe(true);
    expect(isCardLayoutShape(Array(7).fill(null))).toBe(false);
    expect(isCardLayoutShape("x")).toBe(false);
    expect(isCardLayoutShape([{ type: "room", source: "main", extra: 1 }])).toBe(false);
    expect(isCardLayoutShape([{ type: "room", source: "x".repeat(81) }])).toBe(false);
    expect(isCardLayoutShape([[]])).toBe(false);
  });
});

describe("Quad compatibility", () => {
  it("reads Quad's saved keys as cards", () => {
    expect(quadKeyToCard("room:main")).toEqual({ type: "room", source: "main" });
    expect(quadKeyToCard(`dm:${dm.id}`)).toEqual({ type: "dm", source: dm.id });
    for (const bad of ["", "room:", "chart:AAPL", 4, null]) expect(quadKeyToCard(bad)).toBeNull();
  });
  it("starts Six from the Quad layout, then the Gainers Table, then other rooms", () => {
    expect(defaultSixLayout(["room:social", "", `dm:${dm.id}`, "room:shortscout"], options)).toEqual([
      { type: "room", source: "social" },
      { type: "dm", source: dm.id },
      { type: "gainers-table", source: "" },
      { type: "room", source: "main" },
      { type: "room", source: "gainers" },
      null,
    ]);
    expect(defaultSixLayout(null, { rooms: ["social"], conversations: [], gainersTable: false })).toEqual([
      { type: "room", source: "social" },
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
