import { describe, expect, it } from "vitest";
import { chatPhoneDeepLink, chatPhoneScreen, withChatPhoneScreen } from "../chatPhoneNav";

describe("chat phone navigation", () => {
  it("opens the list for plain /chat and a conversation for room, DM, thread and message links", () => {
    expect(chatPhoneDeepLink("/chat")).toBe(false);
    expect(chatPhoneDeepLink("/chat?popout=1")).toBe(false);
    expect(chatPhoneDeepLink("http://localhost:3204/chat?room=social")).toBe(true);
    expect(chatPhoneDeepLink("/chat?room=main&dm=abc")).toBe(true);
    expect(chatPhoneDeepLink("/chat?dm=abc")).toBe(true);
    expect(chatPhoneDeepLink("/chat?room=main&thread=abc")).toBe(true);
    expect(chatPhoneDeepLink("/chat#chat-message-123")).toBe(true);
    expect(chatPhoneDeepLink("/chat#top")).toBe(false);
  });
  it("keeps other history fields when marking the screen", () => {
    const state = { __NA: true, chatReply: { target: "x", depth: 1 } };
    const next = withChatPhoneScreen(state, "conversation");
    expect(next).toEqual({ ...state, chatPhone: "conversation" });
    expect(chatPhoneScreen(next)).toBe("conversation");
    expect(chatPhoneScreen(withChatPhoneScreen(next, "list"))).toBe("list");
    expect(chatPhoneScreen(null)).toBe(null);
    expect(chatPhoneScreen({ chatPhone: "other" })).toBe(null);
    expect(withChatPhoneScreen(null, "list")).toEqual({ chatPhone: "list" });
  });
});
