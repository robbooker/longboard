'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultNotificationPreferences, notificationCategories, type FeatureNotification, type NotificationPreferences } from '@/lib/chatFeatureNotifications';
import styles from './FeatureNotifications.module.css';
import { NotificationSoundTracker } from '@/lib/notificationSound';
import { useNotificationSound } from './hooks/useNotificationSound';

const labels = { requests: 'New requests', replies: 'Replies', mentions: 'Mentions', assistant: 'Codex replies', status: 'Feature status changes' };

export default function FeatureNotifications({ requestId, showLabel = false, portalHost }: { requestId?: string; showLabel?: boolean; portalHost?: HTMLElement | null }) {
  const sound = useNotificationSound();
  const observeSound = sound.observe;
  const [banner, setBanner] = useState<FeatureNotification | null>(null);
  const bannerTracker = useRef(new NotificationSoundTracker());
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 2000);
    return () => clearTimeout(timer);
  }, [banner]);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<FeatureNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [muted, setMuted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const response = await fetch('/api/chat/features/notifications', { cache: 'no-store' });
      const data = await response.json();
      if (version !== sequence.current) return;
      if (!response.ok) {
        if (response.status === 404) { setNotifications([]); setUnread(0); setBanner(null); }
        throw new Error(data.error === 'not_found' ? 'This inbox is not available for your account.' : data.error);
      }
      const items: FeatureNotification[] = data.notifications;
      // Advance the complete stream baseline silently on first load. Only new,
      // unread work-status events may show a banner; dismissal never marks read.
      const fresh = bannerTracker.current.observe(items.map(item => ({ ...item, read_at: item.category === 'status' ? item.read_at : item.created_at })));
      if (fresh && !document.hidden) setBanner(items.find(item => item.category === 'status' && !item.read_at) ?? null);
      observeSound(items);
      setNotifications(data.notifications); setUnread(data.unread);
      setPreferences(data.preferences); setMuted(data.muted); setLoaded(true); setError('');
    } catch (e) {
      if (version === sequence.current) setError(e instanceof Error ? e.message : 'Notifications could not load.');
    }
  }, [observeSound]);

  const invalidate = useCallback(() => { sequence.current++; }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    const refresh = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); invalidate(); };
  }, [load, invalidate]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  async function save(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/chat/features/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  const important = notifications.some(n => n.important && !n.read_at);
  const content = <div className={styles.root} data-sidebar={!!portalHost} ref={root}>
    <button type="button" ref={button} className={styles.bell} aria-expanded={open} aria-label={`Feature notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => { setOpen(!open); if (!open) void load(); }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {showLabel && <span>Features</span>}
      {unread > 0 && <span className={styles.count} data-important={important}>{unread > 99 ? '99+' : unread}</span>}
      <span className={styles.srOnly} role="status">{unread} unread feature notifications</span>
    </button>
    {open && <section className={styles.panel} aria-label="Feature notifications">
      <div className={styles.heading}><div><strong>Notifications</strong><small>Private feature requests</small></div><button type="button" onClick={() => { setOpen(false); button.current?.focus(); }} aria-label="Close notifications">×</button></div>
      {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
      <div className={styles.toolbar}><span>{unread} unread</span><button type="button" disabled={busy || !unread || !notifications.length} onClick={() => void save({ action: 'read_all', before: notifications[0].created_at })}>Mark all read</button></div>
      <div className={styles.list}>
        {!loaded && !error ? <p>Loading notifications…</p> : notifications.length === 0 && !error ? <p>You’re all caught up. New activity will appear here.</p> : null}
        {notifications.map(n => <article key={n.id} className={styles.item} data-unread={!n.read_at} data-important={n.important && !n.read_at}>
          <Link href={`/chat/features?request=${n.request_id}`} onClick={() => { if (!n.read_at) void save({ action: 'read', id: n.id }); setOpen(false); }}><strong>{n.label}</strong><span className={styles.requestTitle}>{n.request_title}</span>{n.important && <span className={styles.attention}>Needs attention</span>}<time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString()}</time></Link>
          {!n.read_at && <button type="button" disabled={busy} onClick={() => void save({ action: 'read', id: n.id })}>Mark read</button>}
        </article>)}
      </div>
      {requestId && <button type="button" className={styles.mute} disabled={busy || !loaded} onClick={() => void save({ action: 'mute', requestId, muted: !muted.includes(requestId) })}>{muted.includes(requestId) ? 'Unmute this request' : 'Mute this request'}</button>}
      <details className={styles.settings}><summary>Notification preferences</summary><label><input type="checkbox" checked={sound.enabled} onChange={e => sound.toggle(e.target.checked)} />Sound alerts in this browser</label><p>Chime for new unread feature notifications while this page is active. Existing alerts stay silent. Your device volume controls the sound.</p><button type="button" disabled={!sound.enabled} onClick={() => void sound.test()}>Test sound</button>{sound.message && <p role="status">{sound.message}</p>}<p>Choose future alerts. Existing notifications stay in your inbox.</p>{notificationCategories.map(category => <label key={category}><input type="checkbox" checked={preferences[category]} disabled={busy || !loaded} onChange={e => void save({ action: 'preferences', preferences: { ...preferences, [category]: e.target.checked } })}/>{labels[category]}</label>)}</details>
    </section>}
  </div>;
  return <>{portalHost ? createPortal(content, portalHost) : content}
    {banner && createPortal(<aside className={styles.banner} aria-label="Feature update">
      <div role="status" aria-live="polite" aria-atomic="true"><strong>{banner.label}</strong><span>{banner.request_title}</span></div>
      <button type="button" className={styles.bannerDismiss} aria-label="Dismiss feature update" onClick={() => setBanner(null)}>×</button>
    </aside>, document.body)}
  </>;
}
