"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { chatAvatarColor } from "@/lib/chatAvatar";
import type { ReaderShelf, ReaderShelfBook } from "@/lib/reader";
import pageStyles from "../chat/ChatPageView.module.css";
import styles from "./library.module.css";

// #385 The Reader's library: the shelf of books inside the chat, in place of the room, like the
// Gainers Table. Each cover shows the title, author and how far through the member is; opening one
// goes to the full-screen reader at /reader/<id>. Admins also get "Manage books" (upload, order,
// hide, delete), downloaded only when they open it.
const ReaderAdmin = dynamic(() => import("./ReaderAdmin"), { ssr: false });

export function BookCover({ book }: { book: Pick<ReaderShelfBook, "id" | "title" | "author" | "coverUrl"> }) {
  const [broken, setBroken] = useState(false);
  if (book.coverUrl && !broken)
    // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived signed link; not for next/image.
    return <img className={styles.coverImage} src={book.coverUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return (
    <span className={styles.coverPlain} style={{ background: chatAvatarColor(`book:${book.id}`) }} aria-hidden="true">
      <span className={styles.coverPlainTitle}>{book.title}</span>
      {book.author && <span className={styles.coverPlainAuthor}>{book.author}</span>}
    </span>
  );
}

export default function ReaderLibrary() {
  const [shelf, setShelf] = useState<ReaderShelf | null>(null);
  const [error, setError] = useState<"blocked" | "failed" | null>(null);
  const [managing, setManaging] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/reader/books", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 403) return setError("blocked");
      if (!response.ok) throw new Error();
      setShelf((await response.json()) as ReaderShelf);
      setError(null);
    } catch {
      setError("failed");
    }
  }, []);
  useEffect(() => {
    void load();
    // Coming back from a book: show the new progress.
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);

  if (error === "blocked")
    return (
      <div className={pageStyles.page} data-reader-library data-reader-blocked>
        <p className={pageStyles.empty}>The Reader is for Booker Stock Club members.</p>
      </div>
    );
  if (!shelf)
    return (
      <div className={pageStyles.page} data-reader-library>
        <p className={error ? pageStyles.error : pageStyles.empty} role="status">
          {error ? "The library is unavailable right now. Please try again in a moment." : "Opening the library…"}
        </p>
      </div>
    );
  const books = shelf.canManage ? shelf.books.filter((book) => book.ready !== false) : shelf.books;
  return (
    <div className={pageStyles.page} data-reader-library>
      <div className={styles.head}>
        <p className={styles.intro}>Books from Rob for club members. Pick up where you left off on any device.</p>
        {shelf.canManage && (
          <button type="button" className={pageStyles.button} aria-expanded={managing} onClick={() => setManaging(!managing)} data-reader-manage>
            {managing ? "Done" : "Manage books"}
          </button>
        )}
      </div>
      {managing && shelf.canManage && <ReaderAdmin books={shelf.books} onChanged={load} />}
      {books.length === 0 ? (
        <p className={pageStyles.empty} data-reader-empty>
          No books on the shelf yet.
        </p>
      ) : (
        <ul className={styles.shelf} aria-label="Books">
          {books.map((book) => (
            <li key={book.id} className={styles.book} data-reader-book={book.id} data-hidden={book.hidden || undefined}>
              <a className={styles.bookLink} href={`/reader/${book.id}`}>
                <span className={styles.cover}>
                  <BookCover book={book} />
                  {book.hidden && <span className={styles.badge}>Hidden</span>}
                </span>
                <span className={styles.title}>{book.title}</span>
                {book.author && <span className={styles.author}>{book.author}</span>}
                <span className={styles.progress}>
                  <span className={styles.track} aria-hidden="true">
                    <span className={styles.fill} style={{ width: `${book.percent * 100}%` }} />
                  </span>
                  <span className={styles.percent} data-reader-percent>
                    {book.percent > 0 ? `${Math.round(book.percent * 100)}%` : "New"}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
