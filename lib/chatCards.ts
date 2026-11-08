// #379 Six view: the card registry. A card is one slot of a multi-card view (Six today; Quad keeps
// its own saved format, see quadKeyToCard below). Each card type says what it is, which sources a
// member may pick for it, and how to check a saved source. Rendering lives in
// components/chat/cards/cardComponents.tsx, keyed by the same type, so this file stays free of
// React and the server route (app/api/chat/card-layout) validates with exactly these rules.
//
// Adding a card type (e.g. "shortscout-stock" or "chart"):
//   1. add its key to CARD_TYPES and a definition to CARD_DEFINITIONS below;
//   2. say what it needs to know about the member in CardOptions (and fill that in
//      lib/chatCardOptions.server.ts, the one place the server decides access);
//   3. add its component to CARD_COMPONENTS (TypeScript fails until you do).
import { CHAT_ROOMS, type ChatRoom } from "./publicChat";
import type { DirectConversation } from "./chatDirectMessages";
import { quadChoices } from "./chatQuad";

/** Card types in this release. Future: "shortscout-stock" (source: ticker), "chart" (source: ticker + timeframe). */
export const CARD_TYPES = ["room", "dm", "gainers-table"] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** One filled slot. `source` is what the card shows: a room slug, a conversation id, "" for a one-of-a-kind card. */
export type CardSlot = { type: CardType; source: string };
/** A saved layout: one entry per slot, null for an empty slot. */
export type CardLayout = (CardSlot | null)[];

/** What the member can reach, as the server decided it. Every card type reads only this. */
export type CardOptions = {
  rooms: ChatRoom[];
  conversations: DirectConversation[];
  /** Same rule as /api/chat/gainers/table: the members who can open the Gainers room. */
  gainersTable: boolean;
  // Future: shortscout?: boolean (ShortScout stock details), charts?: boolean.
};

/** One pickable source for a card type. */
export type CardSource = { source: string; label: string; otherId?: string };

export type CardDefinition = {
  type: CardType;
  /** Shown in the card type picker. */
  label: string;
  /** One line under the label in the picker. */
  description: string;
  /** False when the type has nothing to choose (one per view, source ""). */
  hasSource: boolean;
  /** Which sources this member may pick. Empty: the type is not offered to this member. */
  sources: (options: CardOptions) => CardSource[];
  /**
   * May the same type + source fill two slots? Chat cards may not: two live copies of one room would
   * fight over drafts and read marks. A future chart card could allow it (same ticker, two timeframes
   * are different sources anyway).
   */
  allowDuplicates?: boolean;
};

export const CARD_DEFINITIONS: Record<CardType, CardDefinition> = {
  room: {
    type: "room",
    label: "Room",
    description: "A chat room you're in",
    hasSource: true,
    sources: (options) =>
      CHAT_ROOMS.filter((room) => options.rooms.includes(room.slug)).map((room) => ({
        source: room.slug,
        label: room.label,
      })),
  },
  dm: {
    type: "dm",
    label: "Direct message",
    description: "One of your existing private conversations",
    hasSource: true,
    // The same conversations Quad offers: no blocked, gone, declined or summary threads.
    sources: (options) =>
      quadChoices([], options.conversations).map((choice) => ({
        source: choice.conversationId!,
        label: choice.label,
        otherId: choice.otherId,
      })),
  },
  "gainers-table": {
    type: "gainers-table",
    label: "Gainers Table",
    description: "Today's gainers with price, volume and company facts",
    hasSource: false,
    sources: (options) => (options.gainersTable ? [{ source: "", label: "Gainers Table" }] : []),
  },
  // "shortscout-stock": { label: "ShortScout stock", hasSource: true, sources: tickers the member follows… },
  // "chart": { label: "Chart", hasSource: true, allowDuplicates: true, sources: … },
};

export const SIX_SLOTS = 6;

export function isCardType(value: unknown): value is CardType {
  return typeof value === "string" && (CARD_TYPES as readonly string[]).includes(value);
}

/** Card types this member can use, in picker order. */
export function availableCardTypes(options: CardOptions): CardDefinition[] {
  return CARD_TYPES.map((type) => CARD_DEFINITIONS[type]).filter((d) => d.sources(options).length > 0);
}

export const cardKey = (slot: CardSlot) => `${slot.type}:${slot.source}`;

/** The source's label, or null when this member can't (or can no longer) use it. */
export function cardSource(slot: CardSlot, options: CardOptions): CardSource | null {
  return CARD_DEFINITIONS[slot.type].sources(options).find((s) => s.source === slot.source) ?? null;
}

/**
 * Checks a saved or submitted layout against what the member can reach now. Bad entries become
 * empty slots in place, so the cards around them don't move: unknown types, sources the member
 * can't reach (rooms they left, DMs that were blocked, Gainers Table without Gainers), repeats,
 * and anything that isn't a card. Always returns exactly `size` slots.
 */
export function validateCardLayout(value: unknown, options: CardOptions, size = SIX_SLOTS): CardLayout {
  const seen = new Set<string>();
  const allowed = new Map(CARD_TYPES.map((type) => [type, new Set(CARD_DEFINITIONS[type].sources(options).map((s) => s.source))]));
  return Array.from({ length: size }, (_, i) => {
    const entry: unknown = Array.isArray(value) ? value[i] : null;
    if (!entry || typeof entry !== "object") return null;
    const { type, source } = entry as { type?: unknown; source?: unknown };
    if (!isCardType(type) || typeof source !== "string" || !allowed.get(type)!.has(source)) return null;
    const slot = { type, source };
    if (!CARD_DEFINITIONS[type].allowDuplicates) {
      if (seen.has(cardKey(slot))) return null;
      seen.add(cardKey(slot));
    }
    return slot;
  });
}

/** Strict shape check for what a browser sends: a list of at most `size` cards or nulls. */
export function isCardLayoutShape(value: unknown, size = SIX_SLOTS): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length <= size &&
    value.every(
      (entry) =>
        entry === null ||
        (typeof entry === "object" &&
          !Array.isArray(entry) &&
          typeof (entry as CardSlot).type === "string" &&
          typeof (entry as CardSlot).source === "string" &&
          (entry as CardSlot).source.length <= 80 &&
          Object.keys(entry).every((k) => k === "type" || k === "source")),
    )
  );
}

/** Quad compat: Quad still saves "room:main" / "dm:<id>" keys in this browser. */
export function quadKeyToCard(key: unknown): CardSlot | null {
  if (typeof key !== "string") return null;
  const [type, ...rest] = key.split(":");
  const source = rest.join(":");
  return (type === "room" || type === "dm") && source ? { type, source } : null;
}

/**
 * The first layout for someone opening Six with nothing saved: their Quad cards in the same order,
 * then the Gainers Table, then rooms they haven't placed yet.
 */
export function defaultSixLayout(quadSaved: unknown, options: CardOptions): CardLayout {
  const wanted: CardSlot[] = Array.isArray(quadSaved) ? quadSaved.map(quadKeyToCard).filter((c): c is CardSlot => !!c) : [];
  wanted.push({ type: "gainers-table", source: "" });
  for (const room of CARD_DEFINITIONS.room.sources(options)) wanted.push({ type: "room", source: room.source });
  const valid = validateCardLayout(wanted, options, wanted.length).filter((c): c is CardSlot => !!c);
  return validateCardLayout(valid.slice(0, SIX_SLOTS), options);
}
