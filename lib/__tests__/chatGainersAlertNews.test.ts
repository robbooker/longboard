import { describe, expect, it, vi } from "vitest";
import { alertNewsMeta, alertNewsTime, postGainersAlertNews, withGainersAlertNews } from "@/lib/chatGainersAlertNews";
import { mergeConfirmedMessages } from "@/lib/chatPendingMessages";
import { mergeMessage, type PublicChatMessage } from "@/lib/publicChat";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = { alert_message_id: A, title: "Freshcorp Announces Clearance", url: "https://dilution.news/abcd1234", source: "ACCESS Newswire", published_at: "2026-11-06T12:02:00+00:00" };
const client = (result: { data: unknown; error: unknown }) => {
  const inFn = vi.fn(async () => result);
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { from, select, inFn };
};
const message = (id: string, extra: Partial<PublicChatMessage> = {}): PublicChatMessage => ({ id, guest_id: null, author_label: "Gainers", body: "🚨 FRSH (+52.60%)", created_at: "2026-11-06T12:10:00.000Z", revision: 1, ...extra });

describe("#436 press release under a Gainers alert", () => {
  it("formats the wire and Eastern time, with the date when it isn't the alert's day", () => {
    // 12:02 UTC on Nov 6 is 7:02 AM in New York (standard time).
    expect(alertNewsTime("2026-11-06T12:02:00Z", "2026-11-06T14:00:00Z")).toBe("7:02 AM ET");
    expect(alertNewsTime("2026-11-06T18:45:00Z", "2026-11-06T19:00:00Z")).toBe("1:45 PM ET");
    // Daylight time: 11:30 UTC in July is 7:30 AM in New York.
    expect(alertNewsTime("2026-07-14T11:30:00Z", "2026-07-14T12:00:00Z")).toBe("7:30 AM ET");
    // The day before (in New York, not UTC: 03:00 UTC Nov 6 is 10 PM Nov 5).
    expect(alertNewsTime("2026-11-06T03:00:00Z", "2026-11-06T14:00:00Z")).toBe("Nov 5, 10:00 PM ET");
    expect(alertNewsTime("2026-11-04T12:02:00Z")).toBe("Nov 4, 7:02 AM ET");
    expect(alertNewsTime("not a date")).toBe("");
    const news = { title: "x", url: "https://dilution.news/x", source: "ACCESS Newswire", published_at: "2026-11-06T12:02:00.000Z" };
    expect(alertNewsMeta(news, "2026-11-06T12:30:00Z")).toBe("ACCESS Newswire · 7:02 AM ET");
    expect(alertNewsMeta({ ...news, source: " " }, "2026-11-06T12:30:00Z")).toBe("7:02 AM ET");
  });

  it("reads what the database answered and never throws", async () => {
    const rpc = vi.fn();
    const db = { rpc };
    rpc.mockResolvedValueOnce({ data: { posted: true, alertMessageId: A }, error: null });
    expect(await postGainersAlertNews(db, "2026-11-06", "FRSH")).toBe("posted");
    expect(rpc).toHaveBeenCalledWith("post_chat_gainers_alert_news", { p_day: "2026-11-06", p_ticker: "FRSH" });
    for (const reason of ["duplicate", "no_alert", "too_late", "no_news", "stale"]) {
      rpc.mockResolvedValueOnce({ data: { posted: false, reason }, error: null });
      expect(await postGainersAlertNews(db, "2026-11-06", "FRSH")).toBe(reason);
    }
    rpc.mockResolvedValueOnce({ data: { posted: false, reason: "something else" }, error: null });
    expect(await postGainersAlertNews(db, "2026-11-06", "FRSH")).toBe("unavailable");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    expect(await postGainersAlertNews(db, "2026-11-06", "FRSH")).toBe("unavailable");
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await postGainersAlertNews(db, "2026-11-06", "FRSH")).toBe("unavailable");
  });

  it("attaches each posted headline to its alert, in the Gainers room only", async () => {
    const db = client({ data: [row, { ...row, alert_message_id: B, url: "javascript:alert(1)" }], error: null });
    const messages = [message(A), message(B), message("33333333-3333-4333-8333-333333333333", { removed: true })];
    const out = await withGainersAlertNews(db, "gainers", messages);
    expect(db.from).toHaveBeenCalledWith("chat_gainers_alert_news");
    expect(db.inFn).toHaveBeenCalledWith("alert_message_id", [A, B]);
    expect(out[0].gainers_news).toEqual({ title: row.title, url: row.url, source: "ACCESS Newswire", published_at: "2026-11-06T12:02:00.000Z" });
    // Not a web link: left off.
    expect(out[1].gainers_news).toBeUndefined();
    expect(out[2]).toBe(messages[2]);
    // Other rooms aren't asked about.
    const other = client({ data: [row], error: null });
    expect(await withGainersAlertNews(other, "main", messages)).toBe(messages);
    expect(other.from).not.toHaveBeenCalled();
    // A failed read (the migration not applied yet) leaves the alerts as they are.
    expect(await withGainersAlertNews(client({ data: null, error: { message: "relation does not exist" } }), "gainers", messages)).toBe(messages);
  });

  it("keeps the headline when a realtime row for the same alert arrives", () => {
    const news = { title: row.title, url: row.url, source: row.source, published_at: "2026-11-06T12:02:00.000Z" };
    const withNews = message(A, { gainers_news: news });
    // Room merges (realtime) and confirmed merges (catch-up, history) both keep it.
    expect(mergeMessage([withNews], message(A))[0].gainers_news).toEqual(news);
    const merged = mergeConfirmedMessages([withNews], [message(A)]);
    expect(merged[0]).toBe(withNews);
    // A history read without it (a newer revision) is taken as it is.
    expect(mergeConfirmedMessages([withNews], [message(A, { revision: 2 })])[0].gainers_news).toBeUndefined();
    // A history read that brings it adds it.
    expect(mergeConfirmedMessages([message(A)], [withNews])[0].gainers_news).toEqual(news);
  });
});
