// #385 Where PDF.js's worker comes from: bundled by Next.js as a separate file from pdfjs-dist.
// Kept in its own module so the browser test can point it at a local copy.
export const PDF_WORKER_URL = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
