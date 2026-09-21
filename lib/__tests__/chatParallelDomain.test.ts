import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ insert: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/chatAdmin', () => ({ createChatAdminClient: () => ({ from: () => ({ insert: mock.insert }) }) }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mock.auth }));
import { GET as start } from '@/app/api/chat/login/start/route';

beforeEach(() => { vi.clearAllMocks(); mock.insert.mockResolvedValue({ error: null }); });
describe('parallel chat login entry', () => {
  it.each([
    ['https://chat.robbooker.com', 'https://chat.robbooker.com'],
    ['https://www.longboardai.com', null],
    ['https://longboardai.com', null],
    ['https://chat.robbooker.com.evil.example', null],
    ['http://chat.robbooker.com', null],
  ])('only opts in the exact HTTPS test host: %s', async (origin, expected) => {
    const response = await start(new NextRequest(`${origin}/api/chat/login/start?room=shortscout&popout=1&chat_origin=https://evil.example`));
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://shortscout.ai');
    expect(target.pathname).toBe('/chat-connect');
    expect(target.searchParams.get('chat_origin')).toBe(expected);
    expect(target.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ return_room: 'shortscout', popout: true }));
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('requires a current account before linking memberships', async () => {
    mock.auth.mockResolvedValue({ ok: false });
    const response = await start(new NextRequest('https://chat.robbooker.com/api/chat/login/start?link=1'));
    expect(response.headers.get('location')).toBe('https://chat.robbooker.com/login?next=%2Fchat');
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
