'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {sameFavorite, type ChatFavorite as Pin, type FavoriteTarget} from '@/lib/chatFavorite';
import styles from './ChatPins.module.css';
const changed = 'chat-pins-changed';
const keyFor = (pin: FavoriteTarget) => pin.kind === 'room' ? `room:${pin.room}` : `dm:${pin.conversationId}`;

type Props = {memberId: string; target?: FavoriteTarget; label?: string; onNavigate?: (pin: Pin) => void};
export default function ChatPins({memberId, target, label, onNavigate}: Props) {
 const [pins, setPins] = useState<Pin[]>([]), [ready, setReady] = useState(false);
 const [busy, setBusy] = useState(false), [error, setError] = useState('');
 const generation = useRef(0), operation = useRef(false);
 const invalidate = useCallback(() => { generation.current++; }, []);
 const read = useCallback(async () => {
  const response = await fetch('/api/chat/pins', {cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Pins could not load.');
  return body.pins as Pin[];
 }, []);
 useEffect(() => {
  let alive = true;
  const load = async () => {
   if (operation.current) return;
   const version = ++generation.current;
   try {
    const next = await read();
    if (alive && version === generation.current) { setPins(next); setReady(true); setError(''); }
   } catch {
    if (alive && version === generation.current) { setPins([]); setReady(false); setError('Pins could not load. Try again.'); }
   }
  };
  void load();
  const refresh = () => { if (document.visibilityState === 'visible') void load(); };
  window.addEventListener(changed, refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => { alive = false; invalidate(); window.removeEventListener(changed, refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
 }, [memberId, read, invalidate]);
 const selected = !!target && pins.some(pin => sameFavorite(pin, target));
 async function save(pin: FavoriteTarget, remove: boolean) {
  if (operation.current) return;
  operation.current = true; setBusy(true); setError('');
  const version = ++generation.current;
  try {
   const response = await fetch('/api/chat/pins', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: remove ? 'unpin' : 'pin', target: pin})});
   const body = await response.json();
   if (!response.ok) throw new Error(body.error || 'Pin could not save.');
   if (version === generation.current) { setPins(body.pins); setReady(true); window.dispatchEvent(new Event(changed)); }
  } catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : 'Pin could not save.'); }
  finally { operation.current = false; if (version === generation.current) setBusy(false); }
 }
 async function navigate(pin: Pin) {
  if (operation.current) return;
  operation.current = true; setBusy(true); setError('');
  const version = ++generation.current;
  try {
   const next = await read();
   if (version !== generation.current) return;
   setPins(next);
   const current = next.find(item => sameFavorite(item, pin));
   if (current) onNavigate?.(current);
   else setError('This pinned conversation is no longer available.');
  } catch (e) { if (version === generation.current) { setPins([]); setError(e instanceof Error ? e.message : 'Pin could not open.'); } }
  finally { operation.current = false; if (version === generation.current) setBusy(false); }
 }
 return <div className={styles.pins} data-chat-pins={target ? 'option' : 'sidebar'}>
  {target ? <button type="button" disabled={!ready || busy} aria-pressed={selected} onClick={() => void save(target, selected)}>{selected ? '📌 ' : ''}{selected ? 'Unpin' : 'Pin'} {label}</button> : <section aria-label="Pinned conversations">
   <h2>Pinned</h2>
   {!ready && !error && <p>Loading pins…</p>}
   {ready && pins.length === 0 && <p>Pin conversations from their settings.</p>}
   {pins.map(pin => <div className={styles.row} key={keyFor(pin)}>
    <button className={styles.open} type="button" disabled={busy} onClick={() => void navigate(pin)} aria-label={`Open pinned ${pin.label}`}><span aria-hidden="true">📌</span> {pin.label}</button>
    <button className={styles.remove} type="button" disabled={busy} aria-label={`Unpin ${pin.label}`} title={`Unpin ${pin.label}`} onClick={() => void save(pin, true)}>×</button>
   </div>)}
  </section>}
  {error && <div><p role="status">{error}</p><button type="button" disabled={busy} onClick={() => window.dispatchEvent(new Event(changed))}>Retry loading pins</button></div>}
 </div>;
}
