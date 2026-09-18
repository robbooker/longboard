'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './CodexActivityTrace.module.css';

/** Decorative working indicator, never a representation of actual worker events. */
export default function CodexActivityTrace({ ticketId, status }: { ticketId: string; status: string }) {
  const working = status === 'in_progress';
  const previous = useRef(status);
  const [completed, setCompleted] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const visible = working || completed;
  let seed = 2166136261;
  for (const character of ticketId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;

  useEffect(() => {
    const finished = previous.current === 'in_progress' && (status === 'ready' || status === 'done');
    previous.current = status;
    setCompleted(finished);
    if (!finished) return;
    const timeout = window.setTimeout(() => setCompleted(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const element = container.current;
    if (!visible || !element) return;
    let inView = true;
    const update = () => { element.dataset.paused = String(!inView || document.hidden); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer?.observe(element);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [visible]);

  if (!visible) return null;
  const timing = { '--trace-duration': `${7 + seed % 5}s`, '--trace-delay': `${-(seed % 61) / 10}s` } as CSSProperties;
  return <span ref={container} className={styles.trace} data-completed={completed} style={timing} aria-hidden="true">
    <svg viewBox="0 0 200 22" focusable="false">
      <path className={styles.rail} d="M4 14 H190" />
      <path className={styles.branch} d={seed % 2 ? 'M74 14 L84 5 H107' : 'M112 14 L122 5 H145'} />
      {[14, 43, 76, 110, 145, 180].map((x, index) => <circle key={x} className={styles.node} cx={x} cy="14" r="2.6" style={{ '--node-delay': `${-(seed % 61) / 10 - (5 - index) * 1.1}s` } as CSSProperties} />)}
      <path className={styles.check} d="m176 11 5 5 10-11" />
    </svg>
  </span>;
}
