export const CHAT_PUSH_OWNER_KEY = 'longboard.chat.push-owner.v1';

export function chatPushPlatform(userAgent: string, platform: string, maxTouchPoints: number, standalone: boolean) {
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return { ios, needsInstall: ios && !standalone, android: /Android/i.test(userAgent) };
}

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export function readPushOwner(storage: Pick<Storage, 'getItem'>): { accountId: string; endpoint: string } | null {
  try {
    const value = JSON.parse(storage.getItem(CHAT_PUSH_OWNER_KEY) || 'null');
    return value && typeof value.accountId === 'string' && typeof value.endpoint === 'string' ? value : null;
  } catch { return null; }
}

export function ownsPushSubscription(owner: ReturnType<typeof readPushOwner>, accountId: string, endpoint: string | undefined): boolean {
  return !!accountId && !!endpoint && owner?.accountId === accountId && owner.endpoint === endpoint;
}

export async function waitForChatWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;
  const worker = registration.installing || registration.waiting;
  if (!worker) throw new Error('Notifications could not start. Refresh the app and try again.');
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timeout); worker.removeEventListener('statechange', changed); };
    const changed = () => {
      if (worker.state === 'activated') { finish(); resolve(); }
      if (worker.state === 'redundant') { finish(); reject(new Error('Notifications could not start. Refresh and try again.')); }
    };
    const timeout = setTimeout(() => { finish(); reject(new Error('Notifications took too long to start. Try again.')); }, 15000);
    worker.addEventListener('statechange', changed);
    changed();
  });
  return registration;
}


export function isChatWorkerRegistration(registration: ServiceWorkerRegistration | undefined): registration is ServiceWorkerRegistration {
  if (!registration) return false;
  try {
    const scope = new URL(registration.scope);
    const worker = registration.active || registration.installing || registration.waiting;
    if (!worker) return false;
    const script = new URL(worker.scriptURL);
    return (scope.pathname === '/chat' || scope.pathname === '/chat/') && script.origin === scope.origin && script.pathname === '/chat-sw.js';
  } catch { return false; }
}

/** Revoke only this account's dedicated chat push endpoint before explicit logout. */
export async function disableCurrentChatPush(accountId: string): Promise<void> {
  if (!accountId || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/chat');
  if (!isChatWorkerRegistration(registration)) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch('/api/chat/push', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error('Could not turn off this device’s chat notifications. Please try signing out again.');
  await subscription.unsubscribe();
  try { localStorage.removeItem(CHAT_PUSH_OWNER_KEY); } catch { /* Persistence can be disabled. */ }
}
