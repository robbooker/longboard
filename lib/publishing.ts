/** Returns true if the essay should be visible right now.
 *  - No `publish_at` field → already published (backward-compatible).
 *  - `publish_at` in the past or now → published.
 *  - `publish_at` in the future → hidden. */
export function isPublished(publishAt?: string | null): boolean {
  if (!publishAt) return true;
  return new Date(publishAt).getTime() <= Date.now();
}
