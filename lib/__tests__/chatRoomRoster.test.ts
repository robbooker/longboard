import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/chatAuth', () => ({ requireChatUser: mocks.auth }));
vi.mock('@/lib/chatAdmin', () => ({ createChatAdminClient: mocks.admin }));
import { POST } from '@/app/api/chat/room-members/route';
import { ROSTER_TTL_MS, resetRoomRosters } from '@/lib/chatRoomRoster';

// HEALTH-2026-10-19-1: the Member List from a per-room eligibility answer kept for a minute.
const id = (i: number) => `12345678-1234-4234-8234-${String(i).padStart(12, '0')}`;
type Member = { id: string; user_id: string; display_name: string | null };
let members: Member[];
let blocks: Array<{ blocker_id: string; blocked_id: string }>;
let ineligible: Set<string>;
let namesError: { message: string; code?: string } | null;
let membersError: unknown;
const rpc = vi.fn();
const from = vi.fn();
const viewerOf = (userId: string) => members.find((m) => m.user_id === userId)?.id;
beforeEach(() => {
  vi.clearAllMocks(); vi.useRealTimers(); resetRoomRosters();
  members = Array.from({ length: 120 }, (_, i) => ({ id: id(i + 1), user_id: 'user-' + (i + 1), display_name: 'Member ' + String(i + 1).padStart(3, '0') }));
  blocks = []; ineligible = new Set(); namesError = null; membersError = null;
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user-1' }, access: { longboard: true, boardroom: false, shortscout: false, admin: false } });
  mocks.admin.mockReturnValue({ rpc, from });
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'longboard_chat_room_member_names') {
      if (namesError) return { error: namesError };
      const actor = viewerOf(args.p_user_id as string);
      if (!actor) return { error: { message: 'member_required' } };
      const hidden = new Set(blocks.filter((b) => b.blocker_id === actor || b.blocked_id === actor).map((b) => (b.blocker_id === actor ? b.blocked_id : b.blocker_id)));
      return { data: members.filter((m) => (args.p_ids as string[]).includes(m.id) && !ineligible.has(m.id) && !hidden.has(m.id)).map(({ id, display_name }) => ({ id, display_name })) };
    }
    if (name === 'longboard_chat_room_members_ordered') return { data: [{ id: id(99), display_name: 'From SQL', sort_rank: 1, sort_name: 'from sql' }] };
    return { data: [] };
  });
  from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain, order: () => chain, or: (filter: string) => { chain.filter = filter; return chain; },
      filter: '',
      range: async (start: number, end: number) => (membersError ? { error: membersError } : { data: members.slice(start, end + 1).map((m) => ({ ...m })) }),
      limit: async () => {
        const actor = /blocker_id\.eq\.([^,]+)/.exec(chain.filter)![1];
        return { data: blocks.filter((b) => b.blocker_id === actor || b.blocked_id === actor) };
      },
    };
    return chain;
  });
});
const post = (body: Record<string, unknown>) => POST(new NextRequest('https://example.test/api/chat/room-members', { method: 'POST', body: JSON.stringify({ room: 'social', ...body }) }));
const namesCalls = () => rpc.mock.calls.filter(([name]) => name === 'longboard_chat_room_member_names');
const names = async (body: Record<string, unknown> = {}) => { const r = await post(body); expect(r.status).toBe(200); return (await r.json()) as { members: Array<{ id: string; display_name: string }>; nextCursor: string | null }; };

it('orders online first then by name, pages with a keyset, and never calls the whole-room function', async () => {
  ineligible.add(id(5));
  const onlineIds = [id(100), id(7)];
  const first = await names({ onlineIds });
  expect(first.members.slice(0, 3).map((m) => m.display_name)).toEqual(['Member 007', 'Member 100', 'Member 001']);
  expect(first.members.map((m) => m.id)).not.toContain(id(5));
  expect(first.members).toHaveLength(50);
  // 120 members: three chunks of 50 checked as the viewer, plus the viewer's own fresh check.
  expect(namesCalls().map(([, args]) => (args as { p_ids: string[] }).p_ids.length)).toEqual([50, 50, 20, 0]);
  expect(namesCalls().every(([, args]) => (args as { p_user_id: string }).p_user_id === 'user-1')).toBe(true);
  const second = await names({ onlineIds, cursor: first.nextCursor });
  const third = await names({ onlineIds, cursor: second.nextCursor });
  const seen = [...first.members, ...second.members, ...third.members].map((m) => m.id);
  expect(new Set(seen).size).toBe(119); expect(third.nextCursor).toBeNull();
  expect(rpc).not.toHaveBeenCalledWith('longboard_chat_room_members_ordered', expect.anything());
});
it('keeps the eligibility answer for a minute per room but reads names, blocks and access fresh', async () => {
  await names();
  rpc.mockClear();
  members[2].display_name = 'Renamed';
  const again = await names({ q: 'renamed' });
  expect(again.members).toEqual([{ id: id(3), display_name: 'Renamed', memberships: [] }]);
  // Only the viewer's own check (no ids) while the room answer is kept.
  expect(namesCalls()).toEqual([['longboard_chat_room_member_names', { p_user_id: 'user-1', p_room: 'social', p_ids: [] }]]);
  blocks.push({ blocker_id: id(3), blocked_id: id(1) });
  expect((await names({ q: 'renamed' })).members).toEqual([]);
  vi.useFakeTimers({ now: Date.now() + ROSTER_TTL_MS + 1, toFake: ['Date'] }); rpc.mockClear();
  await names();
  expect(namesCalls()).toHaveLength(4);
});
it('checks newcomers and members hidden from whoever filled the cache as the current viewer', async () => {
  blocks.push({ blocker_id: id(1), blocked_id: id(2) });
  expect((await names({ q: 'member 002' })).members).toEqual([]);
  members.push({ id: id(500), user_id: 'user-500', display_name: 'Newcomer' });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user-3' }, access: { longboard: true } });
  rpc.mockClear();
  expect((await names({ q: 'member 002' })).members.map((m) => m.id)).toEqual([id(2)]);
  expect(namesCalls()).toEqual([['longboard_chat_room_member_names', { p_user_id: 'user-3', p_room: 'social', p_ids: [id(2), id(500)] }]]);
  expect((await names({ q: 'newcomer' })).members.map((m) => m.id)).toEqual([id(500)]);
});
it.each(['member_required', 'room_access_required'])('fails closed on %s, even with a kept answer, and keeps no denial', async (message) => {
  await names();
  namesError = { message };
  expect((await post({})).status).toBe(403);
  resetRoomRosters();
  expect((await post({})).status).toBe(403);
  namesError = null; rpc.mockClear();
  await names();
  expect(namesCalls()).toHaveLength(4);
  expect(rpc).not.toHaveBeenCalledWith('longboard_chat_room_members_ordered', expect.anything());
});
it('a viewer without a chat member is refused, not listed', async () => {
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'nobody' }, access: { longboard: true } });
  expect((await post({})).status).toBe(403);
});
it.each([
  ['the names function is missing', () => { namesError = { code: 'PGRST202', message: 'Could not find the function' }; }],
  ['the names call times out', () => { namesError = { code: '57014', message: 'canceling statement due to statement timeout' }; }],
  ['the member read fails', () => { membersError = { message: 'boom' }; }],
])('falls back to the database function when %s', async (_label, breakIt) => {
  breakIt();
  expect((await names()).members).toEqual([{ id: id(99), display_name: 'From SQL', memberships: [] }]);
});
it('reads more than one page of members', async () => {
  members = Array.from({ length: 2100 }, (_, i) => ({ id: id(i + 1), user_id: 'user-' + (i + 1), display_name: 'Member ' + String(i + 1).padStart(4, '0') }));
  expect((await names({ q: 'member 2100' })).members.map((m) => m.id)).toEqual([id(2100)]);
});
it('never lists a member without a chat name', async () => {
  members[1].display_name = null;
  expect((await names({ q: '' })).members.map((m) => m.id)).not.toContain(id(2));
});
