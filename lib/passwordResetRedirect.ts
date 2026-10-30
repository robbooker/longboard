const CHAT_ORIGIN = "https://chat.robbooker.com";
const DEFAULT_SITE_URL = "https://longboardai.com";
const RESET_PATH = "/onboarding?mode=reset";

/**
 * Where a password-reset email should return to. Only the exact chat address
 * returns to itself; Longboard shares this page, so every other origin keeps
 * the configured site URL.
 */
export function passwordResetRedirectTo(currentOrigin: string, siteUrl: string | undefined): string {
  const base = currentOrigin === CHAT_ORIGIN ? CHAT_ORIGIN : (siteUrl ?? DEFAULT_SITE_URL);
  return `${base}${RESET_PATH}`;
}
