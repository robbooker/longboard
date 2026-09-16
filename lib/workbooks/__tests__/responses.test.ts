import { describe, expect, it } from "vitest";
import { getWorkbook } from "../definitions";
import { emptyResponse, parseResponse } from "../responses";

const workbook = getWorkbook("act-your-way")!;
describe("workbook response validation", () => {
  it("accepts partial work without requiring the attendee to finish", () => {
    const response = emptyResponse(workbook);
    response.answers.action = "Write one journal entry.";
    expect(parseResponse(response, workbook)).toEqual(response);
  });
  it("rejects malformed answers, oversized values, and invalid evidence dates", () => {
    const response = emptyResponse(workbook);
    expect(parseResponse(null, workbook)).toBeNull();
    expect(parseResponse({ ...response, answers: {} }, workbook)).toBeNull();
    response.answers.action = "a".repeat(5001);
    expect(parseResponse(response, workbook)).toBeNull();
    response.answers.action = "";
    response.evidence[0].date = "2026-02-30";
    expect(parseResponse(response, workbook)).toBeNull();
    response.evidence[0].date = "2028-02-29";
    expect(parseResponse(response, workbook)).not.toBeNull();
  });
  it("strips unknown fields and rejects a missing evidence entry", () => {
    const response = emptyResponse(workbook);
    expect(parseResponse({ ...response, user_id: "another-user", answers: { ...response.answers, extra: "ignore" } }, workbook)).toEqual(response);
    response.evidence.pop();
    expect(parseResponse(response, workbook)).toBeNull();
  });
});
