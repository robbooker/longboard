import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/chatAuth', () => ({ requireChatUser: mocks.auth }));
vi.mock('@/lib/chatAdmin', () => ({ createChatAdminClient: mocks.admin }));
import { GET, POST } from '@/app/api/chat/room-members/route';
const req = (query = 'room=social') => new NextRequest('https://example.test/api/chat/room-members?' + query);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'verified' }, access: { longboard: true, boardroom: false, shortscout: false, admin: false } });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: [] });
});
it('requires authentication before reading the directory', async () => {
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'unauthenticated' });
  expect((await GET(req())).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
});
it.each(['main', 'shortscout', 'lb-announcements', 'ss-announcements'])('rejects unauthorized room %s before privileged lookup', async room => {
  expect((await GET(req('room=' + room))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['', 'room=other', 'room=social&room=main', 'room=social&cursor=bad', 'room=social&q=%25', 'room=social&q=' + 'x'.repeat(29), 'room=social&q=a&q=b'])('rejects malformed request %s', async query => {
  expect((await GET(req(query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('uses verified identity and projects only room-safe identity fields', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ id: 'member', display_name: 'Alice', user_id: 'private', email: 'private' }] });
  const response = await GET(req('room=social&q=%20%20%EF%BC%A1lice%20&userId=forged&limit=999'));
  expect(mocks.rpc).toHaveBeenCalledWith('longboard_chat_room_members', { p_user_id: 'verified', p_room: 'social', p_cursor: null, p_query: 'Alice' });
  expect(await response.json()).toEqual({ members: [{ id: 'member', display_name: 'Alice' }], nextCursor: null });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('caps pages at 50 and uses the last returned ID for the next cursor', async () => {
  mocks.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => ({ id: String(i), display_name: 'Member ' + i })) });
  const result = await (await GET(req())).json(); expect(result.members).toHaveLength(50); expect(result.nextCursor).toBe('49');
});
it('passes a validated keyset cursor to the server', async () => {
  const cursor = '12345678-1234-4234-8234-123456789abc';
  await GET(req('room=social&cursor=' + cursor)); expect(mocks.rpc).toHaveBeenCalledWith('longboard_chat_room_members', expect.objectContaining({ p_cursor: cursor }));
});
it.each(['member_required', 'room_access_required'])('fails closed after authorization changes: %s', async message => {
  mocks.rpc.mockResolvedValue({ error: { message } }); expect((await GET(req())).status).toBe(403);
});
it('hides database details and handles transport failures', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'private schema' } });
  const response = await GET(req()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('schema');
  mocks.rpc.mockRejectedValue(Error('secret')); expect((await GET(req())).status).toBe(503);
});
it('returns the eligible room total independent of search, cursor and forged identity', async () => {
  mocks.rpc.mockResolvedValue({ data: 124 });
  const response = await GET(req('room=social&summary=1&q=Alice&cursor=12345678-1234-4234-8234-123456789abc&userId=forged'));
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('longboard_chat_room_member_count', { p_user_id: 'verified', p_room: 'social' });
  expect(await response.json()).toEqual({ total: 124 });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it.each(['summary=0', 'summary=', 'summary=true', 'summary=1&summary=1'])('rejects invalid summary mode %s', async suffix => {
  expect((await GET(req('room=social&' + suffix))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('requires authentication and room entitlement for counts', async () => {
  expect((await GET(req('room=main&summary=1'))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'unauthenticated' });
  expect((await GET(req('room=social&summary=1'))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['member_required', 'room_access_required'])('fails closed when count RPC denies %s', async message => {
  mocks.rpc.mockResolvedValue({ error: { message } }); expect((await GET(req('room=social&summary=1'))).status).toBe(403);
});
it.each([null, -1, 1.5, '124', {}, Number.MAX_SAFE_INTEGER + 1])('does not present malformed count %j as a valid total', async data => {
  mocks.rpc.mockResolvedValue({ data }); expect((await GET(req('room=social&summary=1'))).status).toBe(503);
});
it('preserves a zero count', async () => {
  mocks.rpc.mockResolvedValue({ data: 0 }); expect(await (await GET(req('room=social&summary=1'))).json()).toEqual({ total: 0 });
});

const post = (body: unknown) => new NextRequest('https://example.test/api/chat/room-members', { method: 'POST', body: JSON.stringify(body) });
const memberId = (i: number) => `12345678-1234-4234-8234-${String(i).padStart(12, '0')}`;
it('orders through a bounded authorized RPC and projects only public names', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ id: memberId(1), display_name: 'Alice', sort_rank: 0, sort_name: 'alice', user_id: 'secret' }] });
  const response = await POST(post({ room: 'social', q: ' Ａlice ', onlineIds: [memberId(1).toUpperCase(), memberId(1)], userId: 'forged' }));
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('longboard_chat_room_members_ordered', {
    p_user_id: 'verified', p_room: 'social', p_query: 'Alice', p_online_ids: [memberId(1)], p_after_rank: null, p_after_name: null, p_after_id: null,
  });
  expect(await response.json()).toEqual({ members: [{ id: memberId(1), display_name: 'Alice' }], nextCursor: null });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('uses returned ordering keys and binds cursors to the complete presence/query/actor snapshot', async () => {
  mocks.rpc.mockResolvedValue({ data: Array.from({ length: 51 }, (_, i) => ({ id: memberId(i), display_name: 'Name ' + i, sort_rank: 0, sort_name: 'name ' + i })) });
  const body = { room: 'social', q: '', onlineIds: [memberId(1), memberId(2)] };
  const first = await (await POST(post(body))).json();
  expect(first.members).toHaveLength(50);
  await POST(post({ ...body, onlineIds: [...body.onlineIds].reverse(), cursor: first.nextCursor }));
  expect(mocks.rpc).toHaveBeenLastCalledWith('longboard_chat_room_members_ordered', expect.objectContaining({ p_after_rank: 0, p_after_name: 'name 49', p_after_id: memberId(49) }));
  for (const changed of [{ onlineIds: [] }, { q: 'Name' }]) {
    mocks.rpc.mockClear();
    expect((await POST(post({ ...body, ...changed, cursor: first.nextCursor }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  }
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'other' }, access: { longboard: true } });
  expect((await POST(post({ ...body, cursor: first.nextCursor }))).status).toBe(400);
});
it.each([null, [], { room: 'unknown' }, { room: 'social', onlineIds: ['fake'] }, { room: 'social', onlineIds: Array(5001).fill(memberId(1)) }, { room: 'social', cursor: 'bad' }, { room: 'social', q: '%' }])('rejects malformed ordered request %j', async body => {
  expect((await POST(post(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('authenticates and checks room access before hint lookup, including hinted self', async () => {
  expect((await POST(post({ room: 'main', onlineIds: [memberId(1)] }))).status).toBe(403);
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'unauthenticated' });
  expect((await POST(post({ room: 'social' }))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['member_required', 'room_access_required'])('ordered directory fails closed after eligibility changes: %s', async message => {
  mocks.rpc.mockResolvedValue({ error: { message } }); expect((await POST(post({ room: 'social' }))).status).toBe(403);
});
