import { describe, expect, it } from "vitest";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, FAQ_TOPIC_MAX, parseFaqItemInput, parseFaqTopic, searchFaqItems } from "@/lib/chatFaq";

// #332: validation and the FAQ's own search.
const items = [
  { id: "1", question: "How do I get the chat on my phone?", answer: "iPhone: Add to Home Screen.\nAndroid: Install app." },
  { id: "2", question: "How do I turn on phone notifications?", answer: "Open the ⋯ menu.\nTap Enable notifications." },
];

describe("searchFaqItems", () => {
  it("shows everything for an empty search", () => {
    expect(searchFaqItems(items, "   ")).toEqual(items);
  });
  it("searches questions and answers, ignoring case", () => {
    expect(searchFaqItems(items, "NOTIFICATIONS").map((item) => item.id)).toEqual(["2"]);
    expect(searchFaqItems(items, "home screen").map((item) => item.id)).toEqual(["1"]);
    expect(searchFaqItems(items, "phone").map((item) => item.id)).toEqual(["1", "2"]);
  });
  it("needs every word, in any order", () => {
    expect(searchFaqItems(items, "android phone").map((item) => item.id)).toEqual(["1"]);
    expect(searchFaqItems(items, "android enable")).toEqual([]);
  });
  it("reads curly apostrophes and accents the same as plain ones", () => {
    const rows = [{ id: "a", question: "What's a café?", answer: "x" }];
    expect(searchFaqItems(rows, "what’s cafe")).toEqual(rows);
  });
  it("treats what is typed as text, not a pattern", () => {
    expect(searchFaqItems(items, ".*")).toEqual([]);
  });
  it("finds nothing that isn't in the items it is given", () => {
    expect(searchFaqItems(items, "quokka")).toEqual([]);
  });
});

describe("parseFaqItemInput", () => {
  it("keeps the answer's line breaks and puts the question on one line", () => {
    expect(parseFaqItemInput({ question: " A\n question ", answer: "  one\r\n\r\ntwo\n " })).toEqual({
      ok: true,
      value: { question: "A question", answer: "one\n\ntwo" },
    });
  });
  it("refuses empty, too long or malformed input", () => {
    for (const body of [null, {}, { question: "q" }, { answer: "a" }, { question: " ", answer: "a" }, { question: "q", answer: 4 },
      { question: "q".repeat(FAQ_QUESTION_MAX + 1), answer: "a" }, { question: "q", answer: "a".repeat(FAQ_ANSWER_MAX + 1) }])
      expect(parseFaqItemInput(body).ok).toBe(false);
  });
});

describe("parseFaqTopic", () => {
  it("collapses to one line and limits the length", () => {
    expect(parseFaqTopic({ topic: " a\nb " })).toEqual({ ok: true, value: "a b" });
    expect(parseFaqTopic({ topic: "" }).ok).toBe(false);
    expect(parseFaqTopic({ topic: "t".repeat(FAQ_TOPIC_MAX + 1) }).ok).toBe(false);
  });
});
