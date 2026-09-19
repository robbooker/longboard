import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationServerKey, chatPushPlatform, ownsPushSubscription, readPushOwner, waitForChatWorker, isChatWorkerRegistration, disableCurrentChatPush } from '../chatPushBrowser';

describe('chat push browser compatibility and account binding', () => {
  it('requires Home Screen install on iPhone browser but not standalone', () => {
    expect(chatPushPlatform('iPhone', 'iPhone', 5, false).needsInstall).toBe(true);
    expect(chatPushPlatform('iPhone', 'iPhone', 5, true).needsInstall).toBe(false);
  });
  it('detects iPad desktop mode without confusing a normal Mac', () => {
    expect(chatPushPlatform('Macintosh', 'MacIntel', 5, false).needsInstall).toBe(true);
    expect(chatPushPlatform('Macintosh', 'MacIntel', 0, false).ios).toBe(false);
  });
  it('does not treat a different or unknown account as opted in', () => {
    const owner = { accountId: 'alice', endpoint: 'https://push/device' };
    expect(ownsPushSubscription(owner, 'alice', owner.endpoint)).toBe(true);
    expect(ownsPushSubscription(owner, 'bob', owner.endpoint)).toBe(false);
    expect(ownsPushSubscription(null, 'alice', owner.endpoint)).toBe(false);
    expect(ownsPushSubscription(owner, 'alice', 'https://push/replaced')).toBe(false);
  });
  it('handles unavailable and corrupt local storage without claiming ownership', () => {
    expect(readPushOwner({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(readPushOwner({ getItem: () => '{' })).toBeNull();
    expect(readPushOwner({ getItem: () => '{"accountId":1}' })).toBeNull();
  });
  it('decodes URL-safe VAPID keys without requiring base64 padding', () => {
    expect([...applicationServerKey('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });
});


describe('chat service worker activation', () => {
  it('uses an already active worker immediately', async () => {
    const registration = { active: {} } as ServiceWorkerRegistration;
    expect(await waitForChatWorker(registration)).toBe(registration);
  });
  it('waits for its own registration rather than an unrelated ready worker', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    const registration = { active: null, installing: worker } as unknown as ServiceWorkerRegistration;
    const promise = waitForChatWorker(registration);
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    expect(await promise).toBe(registration);
  });
  it('rejects failed installation and removes listeners', async () => {
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    const cleanup = vi.spyOn(worker, 'removeEventListener');
    const promise = waitForChatWorker({ active: null, installing: worker } as unknown as ServiceWorkerRegistration);
    worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange'));
    await expect(promise).rejects.toThrow('could not start');
    expect(cleanup).toHaveBeenCalled();
  });
});


it('never treats root stock-alert worker as the chat subscription', () => {
  const registration = (scope: string, scriptURL: string) => ({ scope, active: { scriptURL } }) as ServiceWorkerRegistration;
  expect(isChatWorkerRegistration(registration('https://example.com/', 'https://example.com/OneSignalSDKWorker.js'))).toBe(false);
  expect(isChatWorkerRegistration(registration('https://example.com/chat', 'https://example.com/OneSignalSDKWorker.js'))).toBe(false);
  expect(isChatWorkerRegistration(registration('https://example.com/chat', 'https://example.com/chat-sw.js'))).toBe(true);
});


describe('logout push cleanup', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup(ok: boolean, root = false) {
    const unsubscribe = vi.fn(async () => true);
    const registration = { scope: 'https://example.test/' + (root ? '' : 'chat'), active: { scriptURL: 'https://example.test/' + (root ? 'OneSignalSDKWorker.js' : 'chat-sw.js') }, pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device', unsubscribe }) } };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
    const request = vi.fn(async (_url: string, _init: RequestInit) => ({ ok })); vi.stubGlobal('fetch', request);
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    return { unsubscribe, request };
  }
  it('does not unsubscribe when server revocation failed', async () => {
    const { unsubscribe } = setup(false);
    await expect(disableCurrentChatPush('alice')).rejects.toThrow('try signing out again');
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it('revokes authenticated account endpoint before unsubscribing', async () => {
    const { request, unsubscribe } = setup(true);
    await disableCurrentChatPush('alice');
    expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({ accountId: 'alice', endpoint: 'https://push.example/device' });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('does not touch root stock notifications on chat logout', async () => {
    const { request, unsubscribe } = setup(true, true);
    await disableCurrentChatPush('alice');
    expect(request).not.toHaveBeenCalled(); expect(unsubscribe).not.toHaveBeenCalled();
  });
});
