import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), generate: vi.fn(), from: vi.fn(), room: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", () => ({
  readPublicRoomState: mock.room,
  requireChatOwner: mock.owner,
  requestOriginAllowed: () => true,
}));
vi.mock("@/lib/chatSummary", () => ({ generateChatSummary: mock.generate }));
import { GET, POST } from "@/app/api/chat/admin/route";

const url = (room: string) => `https://longboard.test/api/chat/admin?room=${room}`;
const summarize = (room: string) =>
  POST(new NextRequest(url(room), { method: "POST", body: JSON.stringify({ action: "summarize_now" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({
    ok: true,
    user: { id: "owner" },
    access: { longboard: true, boardroom: true, shortscout: true, admin: true },
  });
  mock.owner.mockResolvedValue({ ok: true, user: { id: "owner" }, admin: { from: mock.from } });
  mock.room.mockResolvedValue({ isOpen: true });
  const rows = { data: [{ id: "old" }], error: null };
  const query: Record<string, unknown> = { then: (done: (r: unknown) => void) => Promise.resolve(rows).then(done) };
  for (const method of ["select", "eq", "order", "limit", "insert"]) query[method] = () => query;
  mock.from.mockReturnValue(query);
  mock.generate.mockResolvedValue({ status: "no_messages" });
});

it("#334: Summarize now is refused for admins and still works elsewhere", async () => {
  expect((await summarize("admins")).status).toBe(400);
  expect(mock.generate).not.toHaveBeenCalled();
  expect((await summarize("main")).status).toBe(200);
  expect(mock.generate).toHaveBeenCalledWith(undefined, "main");
});

it("#334: the owner panel shows no stored daily summaries for admins", async () => {
  const admins = await GET(new NextRequest(url("admins")));
  expect((await admins.json()).summaries).toEqual([]);
  expect(mock.from).not.toHaveBeenCalled();
  const main = await GET(new NextRequest(url("main")));
  expect((await main.json()).summaries).toEqual([{ id: "old" }]);
});
