"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { chatGifFromUrl, type ChatGif as Gif } from "@/lib/chatGifs";
import { GIPHY_API_KEY, loadGif, loadGifs, type LibraryGif } from "@/lib/giphyLibrary";
import styles from "./ChatGif.module.css";

export function ChatGif({ gif, resolved = false }: { gif: Gif; resolved?: boolean }) {
  const [media, setMedia] = useState<Gif | null>(resolved || !GIPHY_API_KEY ? gif : null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (resolved || !GIPHY_API_KEY) return;
    const controller = new AbortController();
    loadGif(gif.id, controller.signal).then(setMedia).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [gif.id, resolved]);
  return (
    <div className={styles.card}>
      <button type="button" className={styles.play} aria-label={playing ? "Pause GIF" : "Play GIF"}
        aria-pressed={playing} disabled={failed || !media} onClick={() => setPlaying(!playing)}>
        {!failed && media ? <Image unoptimized src={playing ? media.url : media.stillUrl} width={320} height={200}
          className={styles.image} alt="Shared GIF" loading="lazy" referrerPolicy="no-referrer"
          onError={() => { setPlaying(false); setFailed(true); }} /> : null}
        <span className={styles.badge}>{failed ? "GIF unavailable" : !media ? "Loading GIF…" : playing ? "Ⅱ Pause GIF" : "▶ Play GIF"}</span>
      </button>
      <a href={gif.pageUrl} target="_blank" rel="noopener noreferrer" className={styles.source}>View on GIPHY ↗</a>
    </div>
  );
}

export function GifComposer({ disabled, onAdd }: { disabled: boolean; onAdd: (url: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LibraryGif | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const gif = selected || chatGifFromUrl(link);
  function close() { setOpen(false); setShowGifs(false); setSelected(null); setLink(""); setError(""); trigger.current?.focus(); }
  function add() {
    if (!gif) { setError("Paste a GIPHY GIF link to continue."); return; }
    if (!onAdd(gif.pageUrl)) { setError("Make room in your message for the GIF link (600 characters total)."); return; }
    close();
  }
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (toolsRef.current?.contains(event.target as Node)) return;
      setOpen(false); setShowGifs(false); setSelected(null); setLink(""); setError("");
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div className={styles.tools} ref={toolsRef} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }}>
    <button type="button" ref={trigger} className={`${styles.button} ${styles.addButton}`} aria-label="Add to message" title="Add to message" disabled={disabled}
      aria-expanded={open} aria-controls={open ? "chat-add-panel" : undefined} onClick={() => open ? close() : setOpen(true)}>+</button>
    {open && !showGifs ? <div id="chat-add-panel" className={styles.addMenu} aria-label="Message additions">
      <button type="button" className={styles.menuItem} autoFocus disabled={disabled} onClick={() => setShowGifs(true)}><span className={styles.gifIcon}>GIF</span><span>Choose a GIF</span></button>
    </div> : null}
    {open && showGifs ? <section id="chat-add-panel" className={styles.panel} aria-label="Add a GIF"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
      <div className={styles.heading}><strong>Add a GIF</strong><button type="button" className={styles.button} onClick={close}>Close</button></div>
      {GIPHY_API_KEY ? !selected ? <GifLibrary disabled={disabled} onSelect={(item) => { setSelected(item); setLink(""); setError(""); }} /> : null : <p>GIF search isn’t connected yet. You can still paste a link below.</p>}
      {selected ? <div className={styles.selection}><strong>{selected.title}</strong><button type="button" className={styles.button} onClick={() => setSelected(null)}>Clear selection</button></div> : null}
      <details><summary>Paste a GIF link instead</summary>
      <p>Copy a GIF link from <a href="https://giphy.com" target="_blank" rel="noopener noreferrer">GIPHY ↗</a> and paste it below. You can add a caption in your message.</p>
      <label htmlFor="chat-gif-link">GIPHY link</label>
      <input id="chat-gif-link" type="url" value={link} maxLength={2048} disabled={disabled}
        placeholder="https://giphy.com/gifs/…" aria-describedby="chat-gif-error" aria-invalid={Boolean(error)}
        onChange={(event) => { setSelected(null); setLink(event.target.value); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      </details>
      {gif ? <ChatGif key={gif.id} gif={gif} resolved={Boolean(selected)} /> : null}
      <p id="chat-gif-error" role="status">{error}</p>
      <button type="button" className={styles.button} disabled={disabled || !gif} onClick={add}>Add to message</button>
    </section> : null}
  </div>;
}

function GifLibrary({ disabled, onSelect }: { disabled: boolean; onSelect: (gif: LibraryGif) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [items, setItems] = useState<LibraryGif[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const result = await loadGifs(query, page, controller.signal);
        if (controller.signal.aborted) return;
        setItems((previous) => page ? [...previous, ...result.items] : result.items);
        setNextOffset(result.nextOffset);
        setMore(result.hasMore);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "GIF search is unavailable.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query && !page ? 400 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, retry]);
  return <div className={styles.library}>
    <label htmlFor="chat-gif-search">Search GIFs</label>
    <input id="chat-gif-search" type="search" autoFocus maxLength={50} value={query} disabled={disabled}
      placeholder="Happy, applause, movies…" onChange={(event) => { setQuery(event.target.value); setPage(0); setItems([]); setMore(false); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
    <div className={styles.heading}><span>{query ? "Search results" : "Trending GIFs"}</span>
      <a href="https://giphy.com" target="_blank" rel="noopener noreferrer"><Image src="/images/powered-by-giphy.png" alt="Powered by GIPHY" width={130} height={28} unoptimized className={styles.attribution} /></a>
    </div>
    <div className={styles.grid} aria-busy={loading}>
      {items.map((item, index) => <button type="button" className={styles.tile} disabled={disabled} key={`${item.id}-${index}`} aria-label={`Choose ${item.title}`} onClick={() => onSelect(item)}>
        <Image unoptimized src={item.thumbnail} alt={item.title} width={160} height={110} loading="lazy" referrerPolicy="no-referrer" />
      </button>)}
    </div>
    <p role="status">{loading ? "Loading GIFs…" : error || (!items.length ? "No GIFs found. Try another search." : "Choose a GIF to preview it.")}</p>
    {error ? <button type="button" className={styles.button} onClick={() => setRetry((value) => value + 1)}>Try again</button> : more ? <button type="button" className={styles.button} disabled={loading || disabled} onClick={() => setPage(nextOffset)}>Load more GIFs</button> : null}
  </div>;
}
