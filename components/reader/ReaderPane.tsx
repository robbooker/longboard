"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import ReaderLibrary from "./ReaderLibrary";

// #406 The Reader in one pane of Quad or one card of Six: the shelf, and a book opened from it reads
// right there (pages, contents, text size, theme, and the place saved to the account as usual).
// "Library" goes back to the shelf. Loaded only when a pane shows the Reader.
const ReaderView = dynamic(() => import("./ReaderView"), { ssr: false });

export default function ReaderPane({ active }: { active: boolean }) {
  const [bookId, setBookId] = useState<string | null>(null);
  return bookId ? (
    <ReaderView bookId={bookId} pane={{ active, onBack: () => setBookId(null) }} />
  ) : (
    <ReaderLibrary onOpenBook={setBookId} />
  );
}
