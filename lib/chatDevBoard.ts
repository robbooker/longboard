/** D-242: feature requests now live on the company dev board, not the old /chat/features channel. */
export const DEV_BOARD_URL = "https://company.robbooker.com/dev";

/** Link attributes for the dev board: a new tab, so the chat stays open. */
export const DEV_BOARD_LINK = {
  href: DEV_BOARD_URL,
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

/** Only chat admins (profiles.role === "admin", the chat's existing admin setting) see the Features link. */
export function showFeaturesLink(isAdmin: boolean | undefined) {
  return isAdmin === true;
}
