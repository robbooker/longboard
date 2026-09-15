"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { chatGifFromUrl, type ChatGif as Gif } from "@/lib/chatGifs";
import styles from "./ChatGif.module.css";

export function ChatGif({ gif }: { gif: Gif }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.card}>
      <button type="button" className={styles.play} aria-label={playing ? "Pause GIF" : "Play GIF"}
        aria-pressed={playing} disabled={failed} onClick={() => setPlaying(!playing)}>
        {!failed ? <Image unoptimized src={playing ? gif.url : gif.stillUrl} width={320} height={200}
          className={styles.image} alt="Shared GIF" loading="lazy" referrerPolicy="no-referrer"
          onError={() => { setPlaying(false); setFailed(true); }} /> : null}
        <span className={styles.badge}>{failed ? "GIF unavailable" : playing ? "Ⅱ Pause GIF" : "▶ Play GIF"}</span>
      </button>
      <a href={gif.pageUrl} target="_blank" rel="noopener noreferrer" className={styles.source}>View on GIPHY ↗</a>
    </div>
  );
}

export function GifComposer({ disabled, onAdd }: { disabled: boolean; onAdd: (url: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const gif = chatGifFromUrl(link);
  function close() { setOpen(false); setLink(""); setError(""); trigger.current?.focus(); }
  function add() {
    if (!gif) { setError("Paste a GIPHY GIF link to continue."); return; }
    if (!onAdd(gif.url)) { setError("Make room in your message for the GIF link (600 characters total)."); return; }
    close();
  }
  return <div className={styles.tools}>
    <button type="button" ref={trigger} className={styles.button} disabled={disabled}
      aria-expanded={open} aria-controls="chat-gif-panel" onClick={() => open ? close() : setOpen(true)}>GIF</button>
    {open ? <section id="chat-gif-panel" className={styles.panel} aria-label="Add a GIF"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <div className={styles.heading}><strong>Add a GIF</strong><button type="button" className={styles.button} onClick={close}>Close</button></div>
      <p>Copy a GIF link from <a href="https://giphy.com" target="_blank" rel="noopener noreferrer">GIPHY ↗</a> and paste it below. You can add a caption in your message.</p>
      <label htmlFor="chat-gif-link">GIPHY link</label>
      <input id="chat-gif-link" type="url" autoFocus value={link} maxLength={2048} disabled={disabled}
        placeholder="https://giphy.com/gifs/…" aria-describedby="chat-gif-error" aria-invalid={Boolean(error)}
        onChange={(event) => { setLink(event.target.value); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      {gif ? <ChatGif key={gif.id} gif={gif} /> : null}
      <p id="chat-gif-error" role="status">{error}</p>
      <button type="button" className={styles.button} disabled={disabled || !gif} onClick={add}>Add to message</button>
    </section> : null}
  </div>;
}
