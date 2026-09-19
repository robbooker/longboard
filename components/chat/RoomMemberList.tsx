'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ChatRoom } from '@/lib/publicChat';
import styles from './RoomMemberList.module.css';

type Member = { id: string; display_name: string };
export default function RoomMemberList({ room, roomLabel, memberId, onlineIds, presenceReady, onSelect }: {
  room: ChatRoom; roomLabel: string; memberId: string; onlineIds: Set<string>; presenceReady: boolean;
  onSelect: (target: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<Array<string | null>>([null]);
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
        const params = new URLSearchParams({ room, q: query });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/chat/room-members?${params}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load members. Please try again.');
        if (!controller.signal.aborted) { setMembers([...data.members].sort((a: Member, b: Member) => a.display_name.localeCompare(b.display_name))); setNextCursor(data.nextCursor); setError(''); }
      } catch (failure) {
        if (!controller.signal.aborted) { setMembers([]); setNextCursor(null); setError(failure instanceof Error ? failure.message : 'Could not load members.'); }
      } finally { running = false; if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = setTimeout(() => void load(), 200);
    const poll = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(poll); document.removeEventListener('visibilitychange', resume); };
  }, [open, room, query, cursor, retry]);

  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  return <div className={styles.wrapper}>
    <button ref={trigger} type="button" className={styles.launch} aria-haspopup="dialog" onClick={() => { setQuery(''); setPages([null]); setOpen(true); }}>Member List</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.content}>
        <header><h2 id={heading}>{roomLabel} members</h2><button type="button" onClick={close} aria-label="Close member list">×</button></header>
        <p>Choose a name to open a DM. Online means connected to this room.</p>
        <label htmlFor={search}>Find a member</label>
        <input id={search} type="search" maxLength={28} placeholder="Search chat names…" value={query} onChange={event => { setQuery(event.target.value); setPages([null]); }}/>
        <p role={error ? 'alert' : 'status'} className={styles.note}>{error || (loading ? 'Loading members…' : members.length ? `${members.length} members on this page` : 'No members found.')}</p>
        {error && <button type="button" className={styles.launch} onClick={() => setRetry(value => value + 1)}>Retry</button>}
        <ul className={styles.members} aria-label="Room members" aria-busy={loading}>
          {members.map(member => <li key={member.id}><button type="button" disabled={member.id === memberId} onClick={() => { close(); onSelect({ id: member.id, name: member.display_name }); }}>
            <strong>{member.display_name}{member.id === memberId ? ' (you)' : ''}</strong>
            <span className={styles.presence} data-online={presenceReady && onlineIds.has(member.id)}><i aria-hidden="true"/>{!presenceReady ? 'Status unavailable' : onlineIds.has(member.id) ? 'Online' : 'Offline'}</span>
          </button></li>)}
        </ul>
        <nav className={styles.pages} aria-label="Member list pages">
          <button type="button" disabled={loading || pages.length === 1} onClick={() => setPages(value => value.slice(0, -1))}>Previous</button>
          <span>Page {pages.length}</span>
          <button type="button" disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setPages(value => [...value, nextCursor]); }}>Next</button>
        </nav>
        <p className={styles.note}>Only chat names are shown. Selecting someone does not send a message; their message-request preferences still apply.</p>
      </div>
    </dialog>}
  </div>;
}
