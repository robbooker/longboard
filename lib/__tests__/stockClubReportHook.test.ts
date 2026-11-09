// #403: the morning report tells the Booker Stock Club as it saves a version. Only today's report
// (New York) reaches the club; a refresh of an older day's report never does; nothing it does can
// fail the report.
import { beforeEach, describe, expect, it, vi } from "vitest";

const postReportPick = vi.fn(async (..._args: unknown[]) => ({ status: "posted", day: "2026-11-09", top: "OMH" }));
const publish = vi.fn();
vi.mock("@/lib/stockClubServer", () => ({ postReportPick: (...args: unknown[]) => postReportPick(...args) }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}) }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: (...args: unknown[]) => publish(...args) }));
const { clubAfterReportSaved } = await import("@/lib/stockClubReportHook");

const MONDAY_734_CT = new Date("2026-11-09T13:34:33Z");

beforeEach(() => {
  postReportPick.mockClear();
  publish.mockClear();
});

describe("after a report version is saved", () => {
  it("today's report: the club posts its #1 and the room is told", async () => {
    expect(await clubAfterReportSaved("2026-11-09", MONDAY_734_CT)).toMatchObject({ status: "posted", top: "OMH" });
    expect(postReportPick).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("club", { kind: "changed", topics: ["history"] });
  });
  it("a refresh of Friday's report on Monday morning does nothing", async () => {
    expect(await clubAfterReportSaved("2026-11-06", MONDAY_734_CT)).toBeNull();
    expect(postReportPick).not.toHaveBeenCalled();
  });
  it("nothing posted: no room event", async () => {
    postReportPick.mockResolvedValueOnce({ status: "done_for_day", day: "2026-11-09", top: "CKX" });
    await clubAfterReportSaved("2026-11-09", MONDAY_734_CT);
    expect(publish).not.toHaveBeenCalled();
  });
  it("a club error never reaches the report", async () => {
    postReportPick.mockRejectedValueOnce(new Error("club_unavailable"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(clubAfterReportSaved("2026-11-09", MONDAY_734_CT)).resolves.toBeNull();
    quiet.mockRestore();
  });
});
