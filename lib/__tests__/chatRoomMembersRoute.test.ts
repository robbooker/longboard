import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/chatAuth', () => ({ requireChatUser: mocks.auth }));
vi.mock('@/lib/chatAdmin', () => ({ createChatAdminClient: mocks.admin }));
import { GET } from '@/app/api/chat/room-members/route';
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
