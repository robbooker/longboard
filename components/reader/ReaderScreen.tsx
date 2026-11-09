"use client";
import dynamic from "next/dynamic";

// #385 The reading screen is drawn in the browser only: it needs the saved theme and text size and
// downloads the book itself, so there is nothing useful to render on the server.
const ReaderView = dynamic(() => import("./ReaderView"), { ssr: false });
export default function ReaderScreen({ bookId }: { bookId: string }) {
  return <ReaderView bookId={bookId} />;
}
