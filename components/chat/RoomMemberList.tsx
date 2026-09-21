'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ChatRoom } from '@/lib/publicChat';
import styles from './RoomMemberList.module.css';

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Member = { id: string; display_name: string };
export default function RoomMemberList({ room, roomLabel, memberId, onlineIds, presenceReady, onSelect }: {
  room: ChatRoom; roomLabel: string; memberId: string; onlineIds: Set<string>; presenceReady: boolean;
  onSelect: (target: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<{ room: ChatRoom; total: number } | null>(null);
  const [query, setQuery] = useState('');
  const presenceIds = presenceReady ? [...onlineIds].filter(id => MEMBER_ID.test(id)).map(id => id.toLowerCase()).sort() : [];
  const snapshot = JSON.stringify([...new Set(presenceIds)]);
  const scope = JSON.stringify([room, memberId, query, presenceReady, snapshot]);
  const [pagination, setPagination] = useState<{ scope: string; pages: Array<string | null> }>({ scope: '', pages: [null] });
  // Persist the reset so a later return to an old snapshot cannot revive its page.
  if (pagination.scope !== scope) setPagination({ scope, pages: [null] });
  const pages = pagination.scope === scope ? pagination.pages : [null];
  const onlineSnapshot = new Set(presenceIds);
  const [loadedScope, setLoadedScope] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId(), search = useId();
  const cursor = pages[pages.length - 1];

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const loadCount = async () => {
      if (running || document.hidden || controller.signal.aborted) return;
      running = true;
      try {
        const params = new URLSearchParams({ room, summary: '1' });
        const response = await fetch(`/api/chat/room-members?${params}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Count unavailable');
        if (!controller.signal.aborted) setCount({ room, total: data.total });
      } catch {
        if (!controller.signal.aborted) setCount(null);
      } finally { running = false; }
    };
    void loadCount();
    const poll = setInterval(() => void loadCount(), 60000);
    document.addEventListener('visibilitychange', loadCount);
    return () => { controller.abort(); clearInterval(poll); document.removeEventListener('visibilitychange', loadCount); };
  }, [room, memberId]);

  const visibleMembers = loadedScope === scope ? members : [];
  const pageLoading = loading || loadedScope !== scope;

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let running = false;
    setMembers([]); setNextCursor(null); setLoading(true); setError('');
    const load = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        if (JSON.parse(snapshot).length > 5000) throw new Error('Too many connected members to load this list. Please try again later.');
        const response = await fetch('/api/chat/room-members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, q: query, cursor, onlineIds: JSON.parse(snapshot) }), cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load members. Please try again.');
        if (!controller.signal.aborted) { setMembers(data.members); setNextCursor(data.nextCursor); setError(''); }
      } catch (failure) {
        if (!controller.signal.aborted) { setMembers([]); setNextCursor(null); setError(failure instanceof Error ? failure.message : 'Could not load members.'); }
      } finally { running = false; if (!controller.signal.aborted) { setLoading(false); setLoadedScope(scope); } }
    };
    const timer = setTimeout(() => void load(), 200);
    const poll = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(poll); document.removeEventListener('visibilitychange', resume); };
  }, [open, room, query, cursor, retry, snapshot, scope]);

  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <div className={styles.wrapper}>
    <button ref={trigger} type="button" className={styles.launch} aria-haspopup="dialog" onClick={() => { setQuery(''); setPagination({ scope: '', pages: [null] }); setOpen(true); }}>Member List{count?.room === room ? ` (${count.total.toLocaleString()})` : ''}</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.content}>
        <header><h2 id={heading}>{roomLabel} members</h2><button type="button" onClick={close} aria-label="Close member list">×</button></header>
        <p>Choose a name to open a DM. Online means connected to this room.</p>
        <label htmlFor={search}>Find a member</label>
        <input id={search} type="search" maxLength={28} placeholder="Search chat names…" value={query} onChange={event => { setQuery(event.target.value); setPagination({ scope: '', pages: [null] }); }}/>
        <p role={error ? 'alert' : 'status'} className={styles.note}>{error || (pageLoading ? 'Loading members…' : visibleMembers.length ? `${visibleMembers.length} members on this page` : 'No members found.')}</p>
        {error && <button type="button" className={styles.launch} onClick={() => setRetry(value => value + 1)}>Retry</button>}
        <ul className={styles.members} aria-label="Room members" aria-busy={pageLoading}>
          {visibleMembers.map(member => <li key={member.id}><button type="button" disabled={member.id === memberId} onClick={() => { close(); onSelect({ id: member.id, name: member.display_name }); }}>
            <strong>{member.display_name}{member.id === memberId ? ' (you)' : ''}</strong>
            <span className={styles.presence} data-online={presenceReady && onlineSnapshot.has(member.id.toLowerCase())}><i aria-hidden="true"/>{!presenceReady ? 'Status unavailable' : onlineSnapshot.has(member.id.toLowerCase()) ? 'Online' : 'Offline'}</span>
          </button></li>)}
        </ul>
        <nav className={styles.pages} aria-label="Member list pages">
          <button type="button" disabled={pageLoading || pages.length === 1} onClick={() => setPagination({ scope, pages: pages.slice(0, -1) })}>Previous</button>
          <span>Page {pages.length}</span>
          <button type="button" disabled={pageLoading || !nextCursor} onClick={() => { if (nextCursor) setPagination({ scope, pages: [...pages, nextCursor] }); }}>Next</button>
        </nav>
        <p className={styles.note}>Only chat names are shown. Selecting someone does not send a message; their message-request preferences still apply.</p>
      </div>
    </dialog>}
  </div>;
}
