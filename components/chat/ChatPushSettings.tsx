'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { applicationServerKey, CHAT_PUSH_OWNER_KEY, chatPushPlatform, isChatWorkerRegistration, waitForChatWorker } from '@/lib/chatPushBrowser';
import styles from './ChatPushSettings.module.css';

export default function ChatPushSettings({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ configured: boolean; publicKey?: string } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [environment, setEnvironment] = useState({ supported: false, needsInstall: false, ios: false, android: false, denied: false });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;
  const operation = useRef(0);
  const heading = useId();

  useEffect(() => {
    const show = () => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(true); };
    window.addEventListener('chat-open-push-settings', show);
    return () => window.removeEventListener('chat-open-push-settings', show);
  }, []);
  useEffect(() => { setOpen(false); setEnabled(false); setConfig(null); operation.current++; }, [accountId]);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const generation = operation;
    node?.showModal();
    const token = ++operation.current;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
    const platform = chatPushPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints, standalone);
    const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setEnvironment({ ...platform, supported, denied: 'Notification' in window && Notification.permission === 'denied' });
    setMessage(''); setError(''); setConfig(null); setEnabled(false); setBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/chat/push', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load notification settings. Try again.');
        const data = await response.json();
        if (data.accountId !== accountId) throw new Error('Your account changed. Open notification settings again.');
        const registration = supported ? await navigator.serviceWorker.getRegistration('/chat') : undefined;
        const subscription = isChatWorkerRegistration(registration) ? await registration.pushManager.getSubscription() : null;
        if (token !== operation.current) return;
        setConfig(data);
        if (subscription) {
          const ownedResponse = await fetch(`/api/chat/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, { cache: 'no-store' });
          if (!ownedResponse.ok) throw new Error('Could not verify this device. Try again.');
          const owned = await ownedResponse.json();
          if (token === operation.current) setEnabled(owned.accountId === accountId && owned.subscribed === true);
        }
      } catch (failure) { if (token === operation.current) setError(failure instanceof Error ? failure.message : 'Could not load notifications.'); }
      finally { if (token === operation.current) setBusy(false); }
    })();
    return () => { generation.current++; node?.close(); };
  }, [open, accountId]);

  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  async function request(path: string, method: string, body: object, expectedAccount: string) {
    if (currentAccount.current !== expectedAccount) throw new Error('Your account changed. Open notification settings again.');
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, accountId: expectedAccount }) });
    if (!response.ok) throw new Error(response.status === 409 ? 'This device is linked to another account. Disable notifications for that account first, then try again.' : response.status === 401 || response.status === 403 ? 'Sign in again before changing notifications.' : 'Could not save notification settings. Please try again.');
  }
  async function act(action: 'enable' | 'disable' | 'test') {
    if (busy || !accountId) return;
    const expectedAccount = accountId;
    const token = ++operation.current;
    setBusy(true); setError(''); setMessage('');
    try {
      // Permission must be requested before any await, directly from this button gesture (iOS).
      if (action === 'enable') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setEnvironment(previous => ({ ...previous, denied: permission === 'denied' }));
          throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow them in your device or browser settings, then try again.' : 'Notifications were not enabled. You can try again whenever you are ready.');
        }
      }
      if (currentAccount.current !== expectedAccount) throw new Error('Your account changed. Open notification settings again.');
      const registration = action === 'enable'
        ? await waitForChatWorker(await navigator.serviceWorker.register('/chat-sw.js', { scope: '/chat' }))
        : await navigator.serviceWorker.getRegistration('/chat');
      if (!isChatWorkerRegistration(registration)) throw new Error('Enable notifications on this device first.');
      let subscription = await registration.pushManager.getSubscription();
      if (action === 'enable') {
        if (!config?.publicKey) throw new Error('Notifications are not configured yet.');
        // Explicit opt-in only. The server rejects an endpoint owned by another account.
        subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
        await request('/api/chat/push', 'POST', { subscription: subscription.toJSON() }, expectedAccount);
        try { localStorage.setItem(CHAT_PUSH_OWNER_KEY, JSON.stringify({ accountId: expectedAccount, endpoint: subscription.endpoint })); } catch { /* Permission is valid even when local persistence is disabled. */ }
        if (token === operation.current) { setEnabled(true); setMessage('Notifications are enabled on this device.'); }
      } else if (subscription) {
        await request(action === 'test' ? '/api/chat/push/test' : '/api/chat/push', action === 'test' ? 'POST' : 'DELETE', { endpoint: subscription.endpoint }, expectedAccount);
        if (action === 'disable') {
          await subscription.unsubscribe();
          try { localStorage.removeItem(CHAT_PUSH_OWNER_KEY); } catch { /* No persisted state to remove. */ }
          if (token === operation.current) { setEnabled(false); setMessage('Notifications are off on this device.'); }
        } else if (token === operation.current) setMessage('Test sent. Check your device notifications. Focus or Do Not Disturb may silence it.');
      } else throw new Error('Enable notifications on this device first.');
    } catch (failure) { if (token === operation.current) setError(failure instanceof Error ? failure.message : 'Notifications could not be changed.'); }
    finally { if (token === operation.current) setBusy(false); }
  }

  return <>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.content}>
        <header className={styles.header}><h2 id={heading}>Phone notifications</h2><button type="button" onClick={close} aria-label="Close notification settings">×</button></header>
        <p>Get a notification for direct messages and mentions, even when chat is closed. Message text stays private on your lock screen.</p>
        {environment.needsInstall ? <p className={styles.notice}>On iPhone or iPad, open chat in Safari, tap Share → Add to Home Screen, then open the new Chat icon and enable notifications here. Requires iOS or iPadOS 16.4 or later.</p> : !environment.supported ? <p className={styles.notice}>This browser does not support push notifications. Try an up-to-date browser or open the installed Chat app.</p> : null}
        {environment.android && <p>For a chat-only app, choose Install app or Add to Home screen in your browser menu.</p>}
        {config && !config.configured && <p className={styles.notice}>Phone notifications are being set up. Please check back soon.</p>}
        {environment.denied && <p className={styles.notice}>Notifications are blocked. Allow notifications for Chat in your device or browser settings.</p>}
        <div className={styles.actions}>
          {enabled ? <><button type="button" disabled={busy} onClick={() => void act('test')}>Send test notification</button><button type="button" disabled={busy} onClick={() => void act('disable')}>Disable on this device</button></> : <button type="button" disabled={busy || !config?.configured || !environment.supported || environment.needsInstall || environment.denied} onClick={() => void act('enable')}>Enable notifications</button>}
        </div>
        <p className={styles.status} role="status">{busy ? 'Working…' : message}</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </dialog>}
  </>;
}
