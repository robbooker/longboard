import { describe, expect, it } from "vitest";
import { recordingVideoFromUrl, recordingVideosFromText } from "../chatRecordingVideos";

const YT = "5ndWE4BCt_Y";
const LOOM = "510c0c2e6f3b4ea7b1eb2a81ad460866";

describe("recordings room videos (#513)", () => {
  it("recognises every YouTube link shape and builds the player address from the id alone", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${YT}`,
      `https://youtube.com/watch?v=${YT}&feature=share`,
      `https://m.youtube.com/watch?app=desktop&v=${YT}`,
      `http://www.youtube.com/watch?v=${YT}`,
      `https://youtu.be/${YT}`,
      `https://youtu.be/${YT}?si=AbCdEf123`,
      `https://www.youtube.com/live/${YT}`,
      `https://www.youtube.com/live/${YT}?feature=share`,
      `https://www.youtube.com/shorts/${YT}`,
      `https://www.youtube.com/embed/${YT}`,
      `https://www.youtube.com/embed/${YT}/`,
      `https://www.youtube-nocookie.com/embed/${YT}`,
    ]) {
      expect(recordingVideoFromUrl(url), url).toEqual({
        kind: "youtube",
        id: YT,
        start: 0,
        embedUrl: `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1&rel=0`,
        label: "YouTube video",
      });
    }
  });

  it("keeps a YouTube start time", () => {
    for (const [query, seconds] of [["t=90", 90], ["t=90s", 90], ["t=1m30s", 90], ["t=1h2m3s", 3723], ["start=45", 45]] as const) {
      expect(recordingVideoFromUrl(`https://youtu.be/${YT}?${query}`)?.embedUrl, query).toBe(
        `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1&rel=0&start=${seconds}`,
      );
    }
    expect(recordingVideoFromUrl(`https://www.youtube.com/watch?v=${YT}&t=120s`)?.start).toBe(120);
    for (const query of ["t=", "t=abc", "t=-5", "t=1e3", "t=90%26autoplay", "start=9999999", "t=0"])
      expect(recordingVideoFromUrl(`https://youtu.be/${YT}?${query}`)?.embedUrl, query).toBe(
        `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1&rel=0`,
      );
  });

  it("recognises Loom share and embed links", () => {
    for (const url of [
      `https://www.loom.com/share/${LOOM}`,
      `https://loom.com/share/${LOOM}?sid=1234-abcd`,
      `https://www.loom.com/embed/${LOOM}`,
      `https://www.loom.com/share/${LOOM}/`,
    ]) {
      expect(recordingVideoFromUrl(url), url).toEqual({
        kind: "loom",
        id: LOOM,
        start: 0,
        embedUrl: `https://www.loom.com/embed/${LOOM}?autoplay=1`,
        label: "Loom video",
      });
    }
  });

  it("rejects look-alike hosts, other protocols, credentials, ports and malformed ids", () => {
    for (const url of [
      `https://youtube.com.evil.test/watch?v=${YT}`,
      `https://evil.test/youtube.com/watch?v=${YT}`,
      `https://notyoutube.com/watch?v=${YT}`,
      `https://youtu.be.evil.test/${YT}`,
      `https://evil.test/?u=https://youtu.be/${YT}`,
      `https://loom.com.evil.test/share/${LOOM}`,
      `https://www.loom.com.evil.test/embed/${LOOM}`,
      `https://music.youtube.com/watch?v=${YT}`,
      `https://youtube-nocookie.com/embed/${YT}`,
      "javascript:alert(1)",
      `javascript://youtu.be/${YT}`,
      `data:text/html,https://youtu.be/${YT}`,
      `ftp://youtu.be/${YT}`,
      `https://user@youtu.be/${YT}`,
      `https://user:pass@www.youtube.com/watch?v=${YT}`,
      `https://youtu.be:8443/${YT}`,
      "https://youtu.be/",
      "https://youtu.be/short",
      `https://youtu.be/${YT}extra`,
      `https://youtu.be/${YT}/more`,
      "https://youtu.be/5ndWE4BCt%5FY",
      `https://www.youtube.com/watch?v=${YT}"onload="x`,
      `https://www.youtube.com/watch?v=${YT.slice(0, 10)}`,
      "https://www.youtube.com/watch?v=../../evil1",
      "https://www.youtube.com/watch",
      `https://www.youtube.com/playlist?list=${YT}`,
      `https://www.youtube.com/channel/${YT}`,
      `https://www.youtube.com/embed/${YT}/../x`,
      "https://www.youtube.com/embed/videoseries?list=PL123",
      "https://www.loom.com/share/not-a-hex-id",
      `https://www.loom.com/share/${LOOM.slice(1)}`,
      `https://www.loom.com/share/${LOOM}0`,
      `https://www.loom.com/share/${LOOM.toUpperCase()}`,
      `https://www.loom.com/share/folder/${LOOM}`,
      `https://www.loom.com/looms/${LOOM}`,
      "not a url",
      "",
    ])
      expect(recordingVideoFromUrl(url), url).toBeNull();
  });

  it("offers cards only in the two recordings rooms", () => {
    const body = `11/25/26 | LONGBOARD WEBINAR: https://youtu.be/${YT}`;
    expect(recordingVideosFromText("lb-recordings", body)).toHaveLength(1);
    expect(recordingVideosFromText("ss-recordings", body)).toHaveLength(1);
    for (const room of ["main", "shortscout", "social", "lb-announcements", "ss-announcements", "whats-new", "gainers", "club", "developers", "admins"] as const)
      expect(recordingVideosFromText(room, body), room).toEqual([]);
  });

  it("titles a card with the words in front of its link", () => {
    expect(recordingVideosFromText("lb-recordings", `11/25/26 | LONGBOARD WEBINAR: https://youtu.be/${YT}`)[0].title).toBe(
      "11/25/26 | LONGBOARD WEBINAR",
    );
    expect(recordingVideosFromText("ss-recordings", `Intro line\n11/25/26 | MASTERMIND WEBINAR: https://www.loom.com/share/${LOOM}.`)[0]).toMatchObject({
      kind: "loom",
      title: "11/25/26 | MASTERMIND WEBINAR",
    });
    expect(recordingVideosFromText("lb-recordings", `https://youtu.be/${YT}`)[0].title).toBe("");
  });

  it("gives one card per distinct video, three at most, and ignores other links", () => {
    const other = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"];
    const body = [
      `Part 1: https://youtu.be/${YT}`,
      `Same again: https://www.youtube.com/watch?v=${YT}&t=30`,
      "Slides: https://example.com/slides",
      `Part 2: https://www.loom.com/share/${LOOM}`,
      ...other.map((id, index) => `Part ${index + 3}: https://youtu.be/${id}`),
    ].join("\n");
    const videos = recordingVideosFromText("lb-recordings", body);
    expect(videos.map((video) => video.id)).toEqual([YT, LOOM, other[0]]);
    expect(videos.map((video) => video.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    expect(recordingVideosFromText("lb-recordings", "No video here: https://example.com/youtube and loom.com/pricing")).toEqual([]);
    expect(recordingVideosFromText("lb-recordings", `www.youtube.com/watch?v=${YT} and youtube.com/live/${other[0]}`).map((video) => video.id)).toEqual([YT, other[0]]);
  });
});
