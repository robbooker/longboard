// Browser polling for the RVOL scanner panels (/scanner3, the mini scanner, /charts).
//
// The server keeps one shared copy of the scan (refreshed about once a minute while the
// market is open, and by the 5-minute alert cron), so tabs only need to look every couple
// of minutes, and not at all while hidden. When a hidden tab comes back, it refreshes at
// once if its copy is older than the interval.

export const SCANNER_REFRESH_MS = 120_000;

export function startScannerPolling(
  load: () => void,
  intervalMs: number = SCANNER_REFRESH_MS,
): () => void {
  let lastLoad = Date.now();
  const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  const tick = () => {
    if (!isVisible()) return;
    lastLoad = Date.now();
    load();
  };
  const id = window.setInterval(tick, intervalMs);
  const onVisibility = () => {
    if (isVisible() && Date.now() - lastLoad >= intervalMs) tick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
