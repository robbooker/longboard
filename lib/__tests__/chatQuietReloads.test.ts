import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
// #498: fewer background reloads in chat. A room read no longer reloads the DM list, the
// closed bell's timer reads share the 10 s recent answer, Quad/Dual read the bell once for the
// page, and the closed bell checks Product updates once a minute.
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  owners: [] as Array<string | undefined>,
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({ rpc: m.rpc }),
  requestOriginAllowed: () => true,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/components/chat/hooks/useChatActivity", () => ({
  useChatActivity: (memberId?: string) => {
    m.owners.push(memberId);
    return { data: {}, error: "", read: async () => {}, wantLists: () => {} };
  },
}));
// The panes are not drawn on the server (Quad waits for its layout); keep the test light.
vi.mock("@/components/chat/PublicChat", () => ({ default: () => null }));
import { chatReadTouchesDms } from "@/lib/chatActivity";
import { GET as activity } from "@/app/api/chat/activity/route";
import { POST as inbox } from "@/app/api/chat/inbox/route";
import { resetBellCountersForTests } from "@/lib/chatReads/activity";
import { ChatActivityProvider } from "@/components/chat/ChatActivityContext";
import QuadChat from "@/components/chat/QuadChat";
import { FEATURE_NOTIFICATIONS_POLL_MS, watchFeatureNotifications } from "@/components/chat/FeatureNotifications";
import { ChatUpdateCoordinator } from "@/lib/chatUpdateCoordinator";

const id = "10000000-0000-4000-8000-000000000001";
const target = "20000000-0000-4000-8000-000000000002";
const clientId = "30000000-0000-4000-8000-000000000003";
const memberId = "40000000-0000-4000-8000-000000000004";
beforeEach(() => {
  vi.clearAllMocks();
  resetBellCountersForTests();
  m.owners.length = 0;
  m.auth.mockResolvedValue({
    ok: true,
    user: { id },
    access: { longboard: true, boardroom: true, shortscout: false, admin: false },
  });
  m.rpc.mockResolvedValue({ data: { mentionCount: 0, dmCount: 1 }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a mark-read reloads the DM list only when it can change it", () => {
  it("room reads, mentions and room settings reload the bell only", () => {
    for (const body of [
      { kind: "room", room: "main", mentionThrough: 0, roomThrough: 9 },
      { kind: "mention", id, mentionThrough: 4 },
      { kind: "roomLevel", room: "main", level: "mentions" },
      { kind: "preferences", replies: false },
      { kind: "visible", scope: { kind: "room", room: "main" }, messageIds: [id] },
    ])
      expect(chatReadTouchesDms(body), body.kind).toBe(false);
  });
  it("DM, reaction, mark-all and unknown reads also reload the DM list", () => {
    for (const body of [
      { kind: "dm", id, dmThrough: 3 },
      { kind: "reaction", id, reactionThrough: 2 },
      { kind: "all", mentionThrough: 1, dmThrough: 1 },
      { kind: "visible", scope: { kind: "dm", conversationId: id }, messageIds: [id] },
      { kind: "visible" },
      { kind: "something-new" },
    ])
      expect(chatReadTouchesDms(body), String(body.kind)).toBe(true);
  });
});

describe("the bell's recent answer is dropped by every DM inbox write", () => {
  const timer = () =>
    activity(new NextRequest("https://example.test/api/chat/activity?view=a&why=timer&lists=0"));
  const post = (body: Record<string, unknown>) =>
    inbox(
      new NextRequest("https://example.test/api/chat/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  it.each([
    ["read", { action: "read", target, clientId }],
    ["accept", { action: "accept", target }],
    ["decline", { action: "decline", target }],
    ["block", { action: "block", target }],
    ["unblock", { action: "unblock", target }],
    ["settings", { action: "settings", value: true }],
    ["send", { action: "send", target, clientId, body: "hi" }],
    ["a refused write", { action: "nonsense" }],
  ])("%s", async (_name, body) => {
    let now = Date.now() + 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await timer();
    now += 1;
    await timer();
    const bellReads = () => m.rpc.mock.calls.filter(([name]) => name === "chat_activity_inbox").length;
    expect(bellReads()).toBe(1);
    now += 1;
    await post(body);
    now += 1;
    await timer();
    expect(bellReads()).toBe(2);
  });
});

describe("Quad and Dual read the bell once for the page", () => {
  const props = {
    accountId: id,
    room: "main" as const,
    allowedRooms: ["main" as const, "social" as const],
    serverSession: false,
    bootstrap: { member: { id: memberId, display_name: "Ann" } },
  } as unknown as Parameters<typeof QuadChat>[0];
  it("the page holds one activity read for its member", () => {
    for (const dual of [false, true]) {
      m.owners.length = 0;
      renderToStaticMarkup(createElement(QuadChat, { ...props, dual }));
      expect(m.owners.filter(Boolean)).toEqual([memberId]);
    }
  });
  it("each pane's own provider then reuses it instead of reading again", () => {
    const Provider = ChatActivityProvider as (props: { memberId?: string; children?: ReactNode }) => ReactNode;
    const pane = (key: number) => createElement(Provider, { key, memberId }, "pane");
    renderToStaticMarkup(createElement(Provider, { memberId }, ...[0, 1, 2, 3].map(pane)));
    expect(m.owners.filter(Boolean)).toEqual([memberId]);
    expect(m.owners).toHaveLength(5);
  });
});

describe("Product updates are checked once a minute while the bell is closed", () => {
  it("loads on start and on a features signal, otherwise every 60 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const c = new ChatUpdateCoordinator({
      fetch: vi.fn() as unknown as typeof fetch,
      active: () => true,
      now: () => Date.now(),
    });
    c.start();
    for (const healthy of [false, true]) {
      c.setHealthy(healthy);
      const load = vi.fn(async () => {});
      const stop = watchFeatureNotifications(c, load);
      await vi.advanceTimersByTimeAsync(25);
      expect(load).toHaveBeenCalledTimes(1);
      // Timers land on this window's minute boundaries: three in three minutes (eighteen at 10 s).
      await vi.advanceTimersByTimeAsync(3 * FEATURE_NOTIFICATIONS_POLL_MS);
      expect(load).toHaveBeenCalledTimes(4);
      c.invalidate("features");
      await vi.advanceTimersByTimeAsync(150);
      expect(load).toHaveBeenCalledTimes(5);
      stop();
    }
    c.stop();
    expect(FEATURE_NOTIFICATIONS_POLL_MS).toBe(60_000);
  });
});
