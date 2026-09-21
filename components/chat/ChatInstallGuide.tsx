'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './ChatInstallGuide.module.css';

export default function ChatInstallGuide({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useId();

  useEffect(() => {
    const show = () => {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener('chat-open-install-guide', show);
    return () => window.removeEventListener('chat-open-install-guide', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  if (!open) return null;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className={styles.header}>
      <h2 id={heading}>Install on phone</h2>
      <button type="button" onClick={close} aria-label="Close installation guide">×</button>
    </header>
    <div className={styles.content}>
      <p>Put Rob Booker Chat on your home screen, then turn on notifications for messages and mentions.</p>
      <section aria-labelledby={`${heading}-android`}>
        <h3 id={`${heading}-android`}>Android · Chrome</h3>
        <ol>
          <li>Open <strong>longboardai.com/chat</strong> in Chrome and sign in.</li>
          <li>Tap Chrome’s <strong>⋮</strong> beside the address bar (not the chat menu).</li>
          <li>Choose <strong>Install and create shortcut → Install</strong>. Depending on your Chrome version, this may say <strong>Add to Home screen → Install</strong> or <strong>Install app</strong>.</li>
          <li>Follow the prompts, then open the new <strong>Rob Booker Chat</strong> icon.</li>
        </ol>
      </section>
      <section aria-labelledby={`${heading}-iphone`}>
        <h3 id={`${heading}-iphone`}>iPhone · Safari</h3>
        <ol>
          <li>Open <strong>longboardai.com/chat</strong> in Safari and sign in.</li>
          <li>Tap <strong>Share</strong> (you may need to open Safari’s page menu first).</li>
          <li>Choose <strong>Add to Home Screen</strong>. If offered, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>
          <li>Open the new <strong>Rob Booker Chat</strong> icon on your home screen. Sign in again if asked.</li>
        </ol>
        <p className={styles.note}>iPhone notifications require iOS 16.4 or later and opening chat from its home-screen icon.</p>
      </section>
      <section aria-labelledby={`${heading}-notifications`}>
        <h3 id={`${heading}-notifications`}>Turn on notifications</h3>
        <ol>
          <li>In the installed app, open the chat’s <strong>⋯ menu → Phone notifications</strong>.</li>
          <li>Tap <strong>Enable notifications</strong>, then <strong>Allow</strong> when your phone asks.</li>
          <li>Tap <strong>Send test notification</strong> to check it works.</li>
        </ol>
        <p className={styles.note}>Already installed? You can go straight to notifications. If you previously blocked them, allow notifications in your phone or browser settings. Focus or Do Not Disturb can silence alerts.</p>
        {signedIn && <button className={styles.action} type="button" onClick={() => { close(); window.dispatchEvent(new Event('chat-open-push-settings')); }}>Open notification settings</button>}
      </section>
      <p className={styles.note}>Still seeing an older LB home-screen icon? Your phone may keep the installed icon and name. If refreshing does not change it, remove the installed app and add it again, then enable notifications again.</p>
      <p>For updates, choose <strong>Refresh app</strong> in the chat menu. Chat needs an internet connection.</p>
      <p className={styles.sources}>More help: <a href="https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en" target="_blank" rel="noopener noreferrer">Google’s Android guide</a> · <a href="https://support.apple.com/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer">Apple’s iPhone guide</a></p>
    </div>
  </dialog>;
}
