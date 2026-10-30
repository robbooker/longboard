import { describe, expect, it } from "vitest";
import { chatGroupActions } from "@/lib/chatGroupActions";

type M = { id: string; deleted?: boolean; pending?: boolean };
const can = (m: M) => !m.deleted && !m.pending;
const ids = (...list: string[]): M[] => list.map((id) => ({ id }));

describe("chatGroupActions", () => {
  it("a lone message is its own target and not a group", () => {
    expect(chatGroupActions(ids("a"), [false], can)).toEqual([{ inGroup: false, head: true, targetId: "a" }]);
  });
  it("three in a row: first is the head, all target the most recent", () => {
    expect(chatGroupActions(ids("a", "b", "c"), [false, true, true], can)).toEqual([
      { inGroup: true, head: true, targetId: "c" },
      { inGroup: true, head: false, targetId: "c" },
      { inGroup: true, head: false, targetId: "c" },
    ]);
  });
  it("a new message arriving moves the target", () => {
    expect(chatGroupActions(ids("a", "b"), [false, true], can)[0].targetId).toBe("b");
    expect(chatGroupActions(ids("a", "b", "c"), [false, true, true], can)[0].targetId).toBe("c");
  });
  it("skips deleted and still-sending messages at the end of a group", () => {
    const rows: M[] = [{ id: "a" }, { id: "b" }, { id: "c", deleted: true }, { id: "d", pending: true }];
    expect(chatGroupActions(rows, [false, true, true, true], can)[0].targetId).toBe("b");
  });
  it("no target when every message in the group is deleted", () => {
    const rows: M[] = [{ id: "a", deleted: true }, { id: "b", deleted: true }];
    expect(chatGroupActions(rows, [false, true], can)[0]).toEqual({ inGroup: true, head: true, targetId: null });
  });
  it("a break (other person, day divider, time gap) starts a separate group", () => {
    const result = chatGroupActions(ids("a", "b", "c", "d"), [false, true, false, true], can);
    expect(result.map((r) => r.targetId)).toEqual(["b", "b", "d", "d"]);
    expect(result.map((r) => r.head)).toEqual([true, false, true, false]);
  });
  it("a first row marked continued still heads its window", () => {
    expect(chatGroupActions(ids("a", "b"), [true, true], can)[0]).toEqual({ inGroup: true, head: true, targetId: "b" });
  });
  it("handles an empty list", () => {
    expect(chatGroupActions([], [], can)).toEqual([]);
  });
});
