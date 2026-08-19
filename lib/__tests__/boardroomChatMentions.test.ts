import { describe, expect, it } from "vitest";
import {
  applyMention,
  findMentionQuery,
  tokenizeMentionText,
} from "@/lib/boardroomChatMentions";

describe("findMentionQuery", () => {
  it("finds a handle being typed at the start of a message", () => {
    expect(findMentionQuery("@liz", 4)).toEqual({ start: 0, end: 4, query: "liz" });
  });

  it("finds a handle after whitespace", () => {
    expect(findMentionQuery("Chart for @Ro", 13)).toEqual({ start: 10, end: 13, query: "ro" });
  });

  it("does not treat the at sign inside an email as a mention", () => {
    expect(findMentionQuery("rob@example", 11)).toBeNull();
  });

  it("closes after punctuation that cannot be in a handle", () => {
    expect(findMentionQuery("Hello @rob, thanks", 18)).toBeNull();
  });
});

describe("applyMention", () => {
  it("replaces the active query and returns the next cursor", () => {
    expect(applyMention("Hi @ro there", { start: 3, end: 6, query: "ro" }, "robbooker"))
      .toEqual({ value: "Hi @robbooker there", cursor: 14 });
  });
});

describe("tokenizeMentionText", () => {
  it("separates mentions case-insensitively from surrounding text", () => {
    expect(tokenizeMentionText("Ask @Liz and @PEDROBOT."))
      .toEqual([
        { kind: "text", value: "Ask " },
        { kind: "mention", value: "@Liz", handle: "liz" },
        { kind: "text", value: " and " },
        { kind: "mention", value: "@PEDROBOT", handle: "pedrobot" },
        { kind: "text", value: "." },
      ]);
  });

  it("does not highlight an email address as a mention", () => {
    expect(tokenizeMentionText("rob@example.com"))
      .toEqual([{ kind: "text", value: "rob@example.com" }]);
  });
});
