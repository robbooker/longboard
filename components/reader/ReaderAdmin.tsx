"use client";
import { useEffect, useState } from "react";
import {
  READER_COVER_TYPES,
  READER_FORMATS,
  READER_MAX_BOOK_BYTES,
  READER_MAX_COVER_BYTES,
  type ReaderFormat,
  type ReaderShelfBook,
} from "@/lib/reader";
import pageStyles from "../chat/ChatPageView.module.css";
import styles from "./library.module.css";

// #385 Manage books (admins): upload an EPUB or PDF (up to 50 MB) with its title, author and cover,
// then put the shelf in order, hide books from members or delete them. An EPUB's own title, author
// and cover are filled in from the file when it's picked (all of it can be changed before upload).
// Files go straight from this browser into the private bucket through one-time signed upload links.

const formatOf = (file: File): ReaderFormat | null =>
  /\.epub$/i.test(file.name) || file.type === READER_FORMATS.epub.mime ? "epub" : /\.pdf$/i.test(file.name) || file.type === READER_FORMATS.pdf.mime ? "pdf" : null;

async function api(url: string, init: RequestInit) {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(MESSAGES[data.error as string] ?? "That didn’t work. Please try again.");
  return data;
}
const MESSAGES: Record<string, string> = {
  too_large: "That file is over 50 MB.",
  invalid_title: "Give the book a title.",
  invalid_format: "Only EPUB and PDF files can be added.",
  invalid_cover: "The cover must be a JPEG, PNG or WebP image under 5 MB.",
  not_this_format: "That file isn’t a readable EPUB or PDF, so it wasn’t added.",
  file_missing: "The upload didn’t arrive. Please try again.",
  reader_unavailable: "The Reader is unavailable right now. Please try again.",
};

function put(url: string, body: Blob, type: string, onProgress?: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload failed. Please try again.")));
    xhr.onerror = () => reject(new Error("The upload failed. Check your connection."));
    xhr.send(body);
  });
}

/** An EPUB's own title, author and cover image, read in this browser. */
async function epubDetails(file: File): Promise<{ title: string; author: string; cover: Blob | null }> {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await file.arrayBuffer());
  try {
    const meta = await book.loaded.metadata;
    let cover: Blob | null = null;
    const url = await book.coverUrl().catch(() => null);
    if (url) {
      const blob = await (await fetch(url)).blob();
      if (READER_COVER_TYPES[blob.type] && blob.size <= READER_MAX_COVER_BYTES) cover = blob;
    }
    return { title: meta.title ?? "", author: meta.creator ?? "", cover };
  } finally {
    book.destroy();
  }
}

export default function ReaderAdmin({ books, onChanged }: { books: ReaderShelfBook[]; onChanged: () => Promise<void> | void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [cover, setCover] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!cover) return setCoverPreview(null);
    const url = URL.createObjectURL(cover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const pickFile = async (picked: File | null) => {
    setMessage(null);
    setFile(picked);
    if (!picked) return;
    const format = formatOf(picked);
    if (!format) return setMessage({ error: true, text: MESSAGES.invalid_format });
    if (picked.size > READER_MAX_BOOK_BYTES) return setMessage({ error: true, text: MESSAGES.too_large });
    if (!title) setTitle(picked.name.replace(/\.(epub|pdf)$/i, "").replace(/[_-]+/g, " "));
    if (format === "epub") {
      try {
        const details = await epubDetails(picked);
        if (details.title) setTitle(details.title);
        if (details.author) setAuthor(details.author);
        if (details.cover) setCover((current) => current ?? details.cover);
      } catch {
        setMessage({ error: false, text: "Couldn’t read this EPUB’s details; fill them in by hand." });
      }
    }
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || busy) return;
    const format = formatOf(file);
    if (!format) return setMessage({ error: true, text: MESSAGES.invalid_format });
    setMessage(null);
    try {
      setBusy("Starting…");
      const created = await api("/api/chat/reader/books", {
        method: "POST",
        body: JSON.stringify({ title, author, format, byteSize: file.size, cover: cover ? { mime: cover.type, byteSize: cover.size } : null }),
      });
      await put(created.bookUploadUrl, file, READER_FORMATS[format].mime, (n) => setBusy(`Uploading ${n}%`));
      if (cover && created.coverUploadUrl) {
        setBusy("Uploading the cover…");
        await put(created.coverUploadUrl, cover, cover.type).catch(() => {});
      }
      setBusy("Checking the file…");
      await api(`/api/chat/reader/books/${created.id}`, { method: "PATCH", body: JSON.stringify({ ready: true }) });
      setFile(null);
      setTitle("");
      setAuthor("");
      setCover(null);
      (event.target as HTMLFormElement).reset();
      setMessage({ error: false, text: `“${title}” is on the shelf.` });
      await onChanged();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "The upload failed." });
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const act = async (label: string, run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await run();
      await onChanged();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "That didn’t work." });
    } finally {
      setBusy(null);
    }
  };
  const move = (index: number, by: -1 | 1) => {
    const ids = books.map((book) => book.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void act("Saving the order…", () => api("/api/chat/reader/order", { method: "POST", body: JSON.stringify({ ids }) }));
  };

  return (
    <section className={styles.admin} aria-label="Manage books" data-reader-admin>
      <h3 className={styles.adminTitle}>Add a book</h3>
      <form className={styles.form} onSubmit={upload} data-reader-upload>
        <label className={styles.field}>
          EPUB or PDF file (up to 50 MB)
          <input type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} required data-reader-file />
        </label>
        <label className={styles.field}>
          Cover image (optional; an EPUB’s own cover is used if it has one)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCover(e.target.files?.[0] ?? null)} data-reader-cover />
        </label>
        <label className={styles.field}>
          Title
          <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required data-reader-title />
        </label>
        <label className={styles.field}>
          Author
          <input type="text" value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} data-reader-author />
        </label>
        {coverPreview && (
          <div className={styles.coverPreview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
            <img src={coverPreview} alt="" /> Cover
          </div>
        )}
        <div className={styles.formActions}>
          <button type="submit" className={pageStyles.primary} disabled={!file || !title.trim() || !!busy} data-reader-submit>
            Add to the shelf
          </button>
          {busy && (
            <span className={styles.note} role="status">
              {busy}
            </span>
          )}
          {message && (
            <span className={message.error ? pageStyles.error : styles.note} role={message.error ? "alert" : "status"} data-reader-admin-message>
              {message.text}
            </span>
          )}
        </div>
      </form>

      {books.length > 0 && (
        <>
          <h3 className={styles.adminTitle}>Shelf order</h3>
          <ol className={styles.manageList}>
            {books.map((book, index) => (
              <li key={book.id} className={styles.manageRow} data-reader-manage-row={book.id}>
                <span className={styles.manageName}>
                  {book.title}
                  <small>
                    {READER_FORMATS[book.format].label}
                    {book.hidden ? " · hidden" : ""}
                    {book.ready === false ? " · upload unfinished" : ""}
                  </small>
                </span>
                <button type="button" className={styles.iconButton} aria-label={`Move ${book.title} up`} disabled={index === 0 || !!busy} onClick={() => move(index, -1)} data-reader-up>
                  ↑
                </button>
                <button type="button" className={styles.iconButton} aria-label={`Move ${book.title} down`} disabled={index === books.length - 1 || !!busy} onClick={() => move(index, 1)} data-reader-down>
                  ↓
                </button>
                {book.ready !== false && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={!!busy}
                    onClick={() => act("Saving…", () => api(`/api/chat/reader/books/${book.id}`, { method: "PATCH", body: JSON.stringify({ hidden: !book.hidden }) }))}
                    data-reader-hide
                  >
                    {book.hidden ? "Show" : "Hide"}
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Delete “${book.title}”? Members’ places in it are deleted too.`))
                      void act("Deleting…", () => api(`/api/chat/reader/books/${book.id}`, { method: "DELETE" }));
                  }}
                  data-reader-delete
                >
                  Delete
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
