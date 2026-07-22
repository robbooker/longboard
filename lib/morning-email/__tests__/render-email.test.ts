import { describe, expect, it } from "vitest";

import { buildEmailHtml } from "../render-email";
import { emptyStock, type MorningEmailDraft } from "../types";

function draftWithStockCount(count: number): MorningEmailDraft {
  return {
    date: "2026-07-22",
    subject: "Morning Brief",
    stocks: Array.from({ length: count }, (_, index) => ({
      ...emptyStock(),
      ticker: `TEST${index + 1}`,
      change_pct: index + 1,
    })),
    closing1: "Trade your plan.",
    closing2: "— Buddy",
    qa: [],
  };
}

describe("buildEmailHtml", () => {
  it.each([
    [1, "One name"],
    [3, "Three names"],
    [5, "Five names"],
  ])("renders the hero for %i stock(s)", (count, expected) => {
    const html = buildEmailHtml(draftWithStockCount(count), { dateLabel: "WED · JUL 22 · 2026" });

    expect(html).toContain(`${expected}<br/>`);
  });
});
