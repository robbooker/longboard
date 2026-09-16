'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NotificationSoundTracker } from '@/lib/notificationSound';
import type { FeatureNotification } from '@/lib/chatFeatureNotifications';

const preferenceKey = 'longboard-feature-sound-v1';

export function useNotificationSound() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const enabledRef = useRef(false);
  const context = useRef<AudioContext | null>(null);
  const tracker = useRef(new NotificationSoundTracker());

  const unlock = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      if (!window.AudioContext) throw new Error('unsupported');
      const audio = context.current ?? (context.current = new AudioContext());
      if (audio.state === 'suspended') await audio.resume();
      if (enabledRef.current) setMessage(audio.state === 'running' ? '' : 'Click Test sound to allow audio in this browser.');
    } catch { if (enabledRef.current) setMessage('Audio is unavailable or blocked in this browser. Visual notifications still work.'); }
  }, []);

  const play = useCallback(() => {
    const audio = context.current;
    if (!enabledRef.current) return;
    if (!audio || audio.state !== 'running') { setMessage('Click Test sound to allow audio in this browser.'); return; }
    try {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(660, audio.currentTime);
      tone.frequency.setValueAtTime(880, audio.currentTime + 0.12);
      volume.gain.setValueAtTime(0, audio.currentTime);
      volume.gain.linearRampToValueAtTime(0.08, audio.currentTime + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
      tone.connect(volume); volume.connect(audio.destination);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      tone.start(); tone.stop(audio.currentTime + 0.42);
      setMessage('');
    } catch { setMessage('Sound could not play. Visual notifications still work.'); }
  }, []);

  useEffect(() => {
    const read = () => {
      let value = false;
      try { value = localStorage.getItem(preferenceKey) === 'true'; } catch { /* Storage is optional. */ }
      enabledRef.current = value; setEnabled(value);
      if (!value) { setMessage(''); void context.current?.close(); context.current = null; }
    };
    read();
    const storage = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) read(); };
    const gesture = () => { void unlock(); };
    window.addEventListener('storage', storage);
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      void context.current?.close(); context.current = null;
    };
  }, [unlock]);

  const toggle = useCallback((value: boolean) => {
    enabledRef.current = value; setEnabled(value); setMessage('');
    try { localStorage.setItem(preferenceKey, String(value)); } catch { setMessage('This browser cannot remember your sound preference after you leave.'); }
    if (value) void unlock();
    else { void context.current?.close(); context.current = null; }
  }, [unlock]);

  const observe = useCallback((items: FeatureNotification[]) => {
    // Always advance the baseline, even while muted, so enabling never replays old alerts.
    if (tracker.current.observe(items) && enabledRef.current) play();
  }, [play]);
  const test = useCallback(async () => { await unlock(); play(); }, [unlock, play]);
  return { enabled, message, toggle, test, observe };
}
