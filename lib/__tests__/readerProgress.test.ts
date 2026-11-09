import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgressSaver, parsePrefs, saveProgressRequest, startLocation, stepFontSize, themeFromChat } from "@/lib/readerProgress";
import { looksLikeFormat, minutesLeft, parseNewBook, parseProgressInput, parseReaderLocation, progressLabel } from "@/lib/reader";
import { swipeDirection } from "@/components/reader/engine";

describe("#385 progress saver", () => {
  afterEach(() => vi.useRealTimers());

  it("saves only the latest place, a moment after the last page turn", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const saver = createProgressSaver(save, 1500);
    saver.update({ location: "epubcfi(/6/2!/4/1:0)", percent: 0.1 });
    await vi.advanceTimersByTimeAsync(1000);
    saver.update({ location: "epubcfi(/6/4!/4/1:0)", percent: 0.2 });
    await vi.advanceTimersByTimeAsync(1400);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ location: "epubcfi(/6/4!/4/1:0)", percent: 0.2 }, { keepalive: false });
  });

  it("flushes at once with keepalive when the tab is hidden, and does nothing with nothing new", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const saver = createProgressSaver(save, 1500);
    await saver.flush(true);
    expect(save).not.toHaveBeenCalled();
    saver.update({ location: "7", percent: 0.5 });
    await saver.flush(true);
    expect(save).toHaveBeenCalledWith({ location: "7", percent: 0.5 }, { keepalive: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-save the place the book opened at, or the same place twice", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const saver = createProgressSaver(save, 100);
    saver.markSaved({ location: "3", percent: 0.2 });
    saver.update({ location: "3", percent: 0.2 });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    saver.update({ location: "4", percent: 0.3 });
    await vi.advanceTimersByTimeAsync(500);
    saver.update({ location: "4", percent: 0.3 });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed save and tries again on the next flush; a newer turn wins", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const saver = createProgressSaver(save, 10_000);
    saver.update({ location: "5", percent: 0.4 });
    await saver.flush();
    expect(saver.hasPending()).toBe(true);
    await saver.flush();
    expect(saver.hasPending()).toBe(true);
    saver.update({ location: "6", percent: 0.5 });
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith({ location: "6", percent: 0.5 }, { keepalive: false });
    expect(saver.hasPending()).toBe(false);
    saver.cancel();
  });

  it("sends {bookId, location, percent} to the progress route", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const ok = await saveProgressRequest("b1", fetcher as unknown as typeof fetch)({ location: "2", percent: 0.123456 }, { keepalive: true });
    expect(ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/chat/reader/progress");
    expect(init).toMatchObject({ method: "PUT", keepalive: true });
    expect(JSON.parse(init.body)).toEqual({ bookId: "b1", location: "2", percent: 0.1235 });
  });

  it("restores the saved place, or opens at the start", () => {
    expect(startLocation({ location: "epubcfi(/6/8!/4/2/1:0)" })).toBe("epubcfi(/6/8!/4/2/1:0)");
    expect(startLocation(null)).toBeUndefined();
    expect(startLocation({ location: "" })).toBeUndefined();
  });
});

describe("#385 reading settings", () => {
  it("reads saved settings and ignores anything unknown", () => {
    expect(parsePrefs('{"theme":"sepia","fontSize":120}')).toEqual({ theme: "sepia", fontSize: 120 });
    expect(parsePrefs('{"theme":"neon","fontSize":999}')).toEqual({ theme: "auto", fontSize: 100 });
    expect(parsePrefs("not json")).toEqual({ theme: "auto", fontSize: 100 });
    expect(parsePrefs(null)).toEqual({ theme: "auto", fontSize: 100 });
  });
  it("matches the chat theme by default, Terminal included", () => {
    expect(themeFromChat("light")).toBe("light");
    expect(themeFromChat("terminal")).toBe("terminal");
    expect(themeFromChat("dark")).toBe("dark");
    expect(themeFromChat("blade-runner")).toBe("dark");
    expect(themeFromChat(null, true)).toBe("light");
    expect(themeFromChat(null, false)).toBe("dark");
  });
  it("steps the text size within its range", () => {
    expect(stepFontSize(100, 1)).toBe(110);
    expect(stepFontSize(100, -1)).toBe(90);
    expect(stepFontSize(80, -1)).toBe(80);
    expect(stepFontSize(200, 1)).toBe(200);
    expect(stepFontSize(103, 1)).toBe(110);
  });
});

describe("#385 places and progress text", () => {
  it("accepts EPUB CFIs and PDF page numbers only", () => {
    expect(parseReaderLocation("epub", "epubcfi(/6/4[chap01]!/4/2/1:0)")).toBe("epubcfi(/6/4[chap01]!/4/2/1:0)");
    expect(parseReaderLocation("epub", "epubcfi(/6/4!/4,/2/1:0,/4/1:5)")).not.toBeNull();
    expect(parseReaderLocation("epub", "javascript:alert(1)")).toBeNull();
    expect(parseReaderLocation("epub", 'epubcfi(/6/4"><script>)')).toBeNull();
    expect(parseReaderLocation("epub", "12")).toBeNull();
    expect(parseReaderLocation("pdf", "12")).toBe("12");
    expect(parseReaderLocation("pdf", "0")).toBeNull();
    expect(parseReaderLocation("pdf", "epubcfi(/6/4!)")).toBeNull();
    expect(parseReaderLocation("pdf", "x".repeat(700))).toBeNull();
  });
  it("checks a progress save's shape", () => {
    const bookId = "6f1c1f0e-8a8b-4c1e-9d2a-0b3c4d5e6f70";
    expect(parseProgressInput({ bookId, location: "3", percent: 0.5 })).toEqual({ bookId, location: "3", percent: 0.5 });
    expect(parseProgressInput({ bookId, location: "3", percent: 1.5 })).toBeNull();
    expect(parseProgressInput({ bookId: "nope", location: "3", percent: 0.5 })).toBeNull();
    expect(parseProgressInput({ bookId, location: "", percent: 0.5 })).toBeNull();
    expect(parseProgressInput(null)).toBeNull();
  });
  it("estimates minutes left in the chapter and writes the line under the page", () => {
    expect(minutesLeft(2300, 1, 10)).toBe(10);
    expect(minutesLeft(2300, 6, 10)).toBe(5);
    expect(minutesLeft(0, 1, 10)).toBeNull();
    expect(progressLabel(0.374, 5)).toBe("37% · 5 min left in chapter");
    expect(progressLabel(0.5, 0)).toBe("50% · less than a minute left in chapter");
    expect(progressLabel(0.5, null)).toBe("50%");
  });
  it("tells a swipe from a scroll or a slow drag", () => {
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 200, y: 110, t: 200 })).toBe("next");
    expect(swipeDirection({ x: 100, y: 100, t: 0 }, { x: 200, y: 90, t: 200 })).toBe("prev");
    expect(swipeDirection({ x: 100, y: 100, t: 0 }, { x: 120, y: 100, t: 200 })).toBeNull();
    expect(swipeDirection({ x: 100, y: 100, t: 0 }, { x: 160, y: 300, t: 200 })).toBeNull();
    expect(swipeDirection({ x: 300, y: 100, t: 0 }, { x: 100, y: 100, t: 2000 })).toBeNull();
  });
  it("checks uploads: size cap, formats, covers, and the file's first bytes", () => {
    const ok = parseNewBook({ title: " A  Book ", author: "Rob", format: "epub", byteSize: 1000, cover: { mime: "image/png", byteSize: 10 } });
    expect(ok).toEqual({ title: "A Book", author: "Rob", format: "epub", byteSize: 1000, cover: { mime: "image/png", byteSize: 10 } });
    expect(parseNewBook({ title: "A", format: "epub", byteSize: 50 * 1024 * 1024 + 1 })).toEqual({ error: "too_large" });
    expect(parseNewBook({ title: "A", format: "mobi", byteSize: 1 })).toEqual({ error: "invalid_format" });
    expect(parseNewBook({ title: "", format: "pdf", byteSize: 1 })).toEqual({ error: "invalid_title" });
    expect(parseNewBook({ title: "A", format: "pdf", byteSize: 1, cover: { mime: "image/svg+xml", byteSize: 1 } })).toEqual({ error: "invalid_cover" });
    expect(looksLikeFormat("pdf", new TextEncoder().encode("%PDF-1.4"))).toBe(true);
    expect(looksLikeFormat("pdf", new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikeFormat("epub", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeFormat("epub", new TextEncoder().encode("%PDF-1.4"))).toBe(false);
  });
});
