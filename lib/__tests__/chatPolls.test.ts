import { describe, expect, it } from "vitest";
import {
  isPollBody,
  nextPollSelection,
  pollPercent,
  pollQuestionFromBody,
  shapePoll,
  validatePollDraft,
  type RawPoll,
} from "@/lib/chatPolls";
import { ablyRoomEventActions } from "@/lib/chatRealtimeChannels";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = (over: Partial<RawPoll> = {}): RawPoll => ({
  message_id: id(1),
  question: "Which setup?",
  anonymous: true,
  multi: false,
  closed_at: null,
  created_by_me: false,
  voters: 3,
  my_votes: [],
  options: [
    { id: id(10), label: "Long", votes: 2, people: null },
    { id: id(11), label: "Short", votes: 1, people: null },
    { id: id(12), label: "Flat", votes: 0, people: null },
  ],
  ...over,
});

describe("poll drafts", () => {
  it("trims, drops blank rows and defaults to anonymous single-answer", () => {
    expect(validatePollDraft({ question: "  Q? ", options: [" A ", "", "B"] })).toEqual({
      ok: true,
      poll: { question: "Q?", options: ["A", "B"], anonymous: true, multi: false },
    });
    expect(validatePollDraft({ question: "Q", options: ["A", "B"], anonymous: false, multi: true })).toMatchObject({
      ok: true,
      poll: { anonymous: false, multi: true },
    });
  });
  it.each([
    [{ question: "", options: ["A", "B"] }],
    [{ question: "Q", options: ["A"] }],
    [{ question: "Q", options: ["A", " "] }],
    [{ question: "Q", options: Array.from({ length: 11 }, (_, i) => `A${i}`) }],
    [{ question: "Q", options: ["Same", "same"] }],
    [{ question: "x".repeat(301), options: ["A", "B"] }],
    [{ question: "Q", options: ["A", "x".repeat(101)] }],
    [{ question: "Q", options: ["A", 2] }],
    [{ question: "Q", options: ["A", "B"], anonymous: "yes" }],
    [null],
  ])("refuses %j", (input) => {
    expect(validatePollDraft(input).ok).toBe(false);
  });
  it("accepts exactly 2 and 10 answers", () => {
    expect(validatePollDraft({ question: "Q", options: ["A", "B"] }).ok).toBe(true);
    expect(validatePollDraft({ question: "Q", options: Array.from({ length: 10 }, (_, i) => `A${i}`) }).ok).toBe(true);
  });
});

describe("poll messages", () => {
  it("recognises the poll prefix", () => {
    expect(isPollBody("📊 Poll: Which?")).toBe(true);
    expect(isPollBody("Poll: Which?")).toBe(false);
    expect(pollQuestionFromBody("📊 Poll: Which?")).toBe("Which?");
  });
});

describe("shaping a poll for one reader", () => {
  it("hides every count until the reader votes", () => {
    const poll = shapePoll(raw());
    expect(poll.results).toBe(false);
    expect(poll.total).toBeUndefined();
    expect(poll.options.every((o) => o.votes === undefined && o.percent === undefined && !o.people)).toBe(true);
    expect(JSON.stringify(poll)).not.toMatch(/"votes"|"percent"/);
  });
  it("shows counts and percentages of the people who voted after voting", () => {
    const poll = shapePoll(raw({ my_votes: [id(11)] }));
    expect(poll.results).toBe(true);
    expect(poll.total).toBe(3);
    expect(poll.options.map((o) => [o.votes, o.percent])).toEqual([
      [2, 67],
      [1, 33],
      [0, 0],
    ]);
  });
  it("shows final results to everyone once closed, and nobody can close it again", () => {
    const poll = shapePoll(raw({ closed_at: "2026-10-30T12:00:00Z", created_by_me: true }));
    expect(poll.results).toBe(true);
    expect(poll.closed).toBe(true);
    expect(poll.canClose).toBe(false);
  });
  it("only the creator may close an open poll", () => {
    expect(shapePoll(raw({ created_by_me: true })).canClose).toBe(true);
    expect(shapePoll(raw()).canClose).toBe(false);
  });
  it("never names voters of an anonymous poll, even if a row carried them", () => {
    const leaky = raw({
      my_votes: [id(10)],
      created_by_me: true,
      closed_at: "2026-10-30T12:00:00Z",
      options: raw().options.map((o) => ({ ...o, people: [{ id: id(99), name: "Bob" }] })),
    });
    const text = JSON.stringify(shapePoll(leaky));
    expect(text).not.toContain(id(99));
    expect(text).not.toContain("Bob");
  });
  it("names voters on a visible-votes poll only with results", () => {
    const visible = raw({
      anonymous: false,
      options: raw().options.map((o, i) => ({ ...o, people: i === 0 ? [{ id: id(99), name: "Bob" }] : [] })),
    });
    expect(JSON.stringify(shapePoll(visible))).not.toContain("Bob");
    const shown = shapePoll({ ...visible, my_votes: [id(11)] });
    expect(shown.options[0].people).toEqual([{ id: id(99), name: "Bob" }]);
  });
  it("ignores own votes for answers not in the poll", () => {
    expect(shapePoll(raw({ my_votes: [id(77)] })).results).toBe(false);
  });
  it("rounds percentages and handles no votes", () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(0, 0)).toBe(0);
  });
});

describe("choosing answers", () => {
  it("single-answer polls switch or take back", () => {
    expect(nextPollSelection({ multi: false, myVotes: [] }, "a")).toEqual(["a"]);
    expect(nextPollSelection({ multi: false, myVotes: ["a"] }, "b")).toEqual(["b"]);
    expect(nextPollSelection({ multi: false, myVotes: ["a"] }, "a")).toEqual([]);
  });
  it("multi-answer polls toggle", () => {
    expect(nextPollSelection({ multi: true, myVotes: ["a"] }, "b")).toEqual(["a", "b"]);
    expect(nextPollSelection({ multi: true, myVotes: ["a", "b"] }, "a")).toEqual(["b"]);
  });
});

describe("poll realtime signals", () => {
  it("re-reads just the poll on screen and moves no badge", () => {
    expect(
      ablyRoomEventActions("main", ["main"], "changed", { kind: "changed", topics: ["polls"], messageId: id(1) }),
    ).toEqual({ detail: null, topics: [], poll: { room: "main", messageId: id(1) } });
  });
  it("ignores polls in rooms not on screen and bad ids", () => {
    expect(
      ablyRoomEventActions("main", ["social"], "changed", { kind: "changed", topics: ["polls"], messageId: id(1) }),
    ).toEqual({ detail: null, topics: [] });
    expect(
      ablyRoomEventActions("main", ["main"], "changed", { kind: "changed", topics: ["polls"], messageId: "x" }),
    ).toEqual({ detail: null, topics: [] });
  });
});
