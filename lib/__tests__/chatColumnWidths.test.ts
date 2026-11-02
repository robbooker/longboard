import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CHAT_COLUMN_WIDTHS_SCRIPT, chatColumnDefault, chatColumnMax, parseChatColumnWidths } from "../chatColumnWidths";

const SAMPLES = [
  null,
  "",
  "not json",
  "null",
  "42",
  '"text"',
  "[]",
  "{}",
  '{"left":300,"right":500}',
  '{"left":160,"right":640}',
  '{"left":159,"right":641}',
  '{"left":-5,"right":99999}',
  '{"left":"300","right":null}',
  '{"left":1e999}',
  '{"right":300.5}',
];

/** Runs the page's early script against a fake browser; returns the variables it set. */
function runEarlyScript(raw: string | null, getItem?: () => string | null) {
  const set: Record<string, string> = {};
  runInNewContext(CHAT_COLUMN_WIDTHS_SCRIPT, {
    localStorage: { getItem: getItem ?? (() => raw) },
    document: {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => {
            set[name] = value;
          },
        },
      },
    },
  });
  return set;
}

describe("chat column widths", () => {
  it("keeps widths in range and drops anything else", () => {
    expect(parseChatColumnWidths('{"left":300,"right":500}')).toEqual({ left: 300, right: 500 });
    expect(parseChatColumnWidths('{"left":159,"right":500}')).toEqual({ right: 500 });
    expect(parseChatColumnWidths('{"left":421,"right":641}')).toEqual({});
    expect(parseChatColumnWidths("not json")).toEqual({});
    expect(parseChatColumnWidths(null)).toEqual({});
    expect(parseChatColumnWidths("42")).toEqual({});
    expect(parseChatColumnWidths('{"left":"300"}')).toEqual({});
    expect(parseChatColumnWidths('{"left":1e999}')).toEqual({});
  });

  it("the page's early script accepts exactly what the parser accepts", () => {
    for (const raw of SAMPLES) {
      const parsed = parseChatColumnWidths(raw);
      const expected: Record<string, string> = {};
      if (parsed.left !== undefined) expected["--chat-left-width"] = `${parsed.left}px`;
      if (parsed.right !== undefined) expected["--chat-right-width"] = `${parsed.right}px`;
      expect(runEarlyScript(raw), String(raw)).toEqual(expected);
    }
  });

  it("the early script survives storage that throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    expect(runEarlyScript(null, blocked)).toEqual({});
  });

  it("defaults match the widths from before columns could be resized", () => {
    expect(chatColumnDefault("left", false)).toBe(240);
    expect(chatColumnDefault("left", true)).toBe(220);
    expect(chatColumnDefault("right", true)).toBe(350);
  });

  it("a dragged column leaves the chat its minimum, and never goes under its own", () => {
    expect(chatColumnMax("left", 1238, 350)).toBe(420);
    expect(chatColumnMax("left", 1058, 350)).toBe(348);
    expect(chatColumnMax("right", 1238, 220)).toBe(640);
    expect(chatColumnMax("right", 1098, 400)).toBe(338);
    expect(chatColumnMax("right", 700, 400)).toBe(300);
  });
});
