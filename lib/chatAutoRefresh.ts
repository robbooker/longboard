/** How long without input before an open, visible chat counts as idle. */
export const CHAT_AUTO_REFRESH_IDLE_MS = 3 * 60_000;
export const CHAT_AUTO_REFRESH_KEY = "longboard-chat-auto-refresh-version";

/**
 * Whether a ready update may reload this chat without asking. Never mid-use: only a
 * background tab, a tab the person just returned to, or one idle for a few minutes, and
 * at most once per version (a version that still differs after reloading never loops).
 * The caller still runs the chat-before-refresh guard, which blocks unsent work.
 */
export function shouldAutoRefresh({
  readyVersion,
  attemptedVersion,
  hidden,
  returning,
  idleMs,
  online,
}: {
  readyVersion: string | null;
  attemptedVersion: string | null;
  hidden: boolean;
  returning: boolean;
  idleMs: number;
  online: boolean;
}) {
  if (!readyVersion || !online || attemptedVersion === readyVersion) return false;
  return hidden || returning || idleMs >= CHAT_AUTO_REFRESH_IDLE_MS;
}
