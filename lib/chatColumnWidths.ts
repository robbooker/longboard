/**
 * D-353: how wide a member wants the rooms and replies columns on this browser. The middle column
 * always takes what is left, so only these two are saved. Nothing is sent to the server.
 *
 * The CSS in PublicChat.module.css repeats the minimums (160px / 360px / 300px) in its grid tracks.
 * They add up to less than the narrowest window with columns (1100px), so all three always fit.
 */
export const CHAT_COLUMN_STORAGE_KEY = "chat-column-widths-v1";

export type ChatColumnSide = "left" | "right";
export type ChatColumnWidths = { left?: number; right?: number };

export const CHAT_COLUMN_LIMITS = {
  left: { min: 160, max: 420 },
  right: { min: 300, max: 640 },
} as const;
export const CHAT_MIDDLE_MIN = 360;

/** Widths when nothing is saved. The rooms column is a little narrower while replies are open. */
export function chatColumnDefault(side: ChatColumnSide, replyOpen: boolean) {
  if (side === "right") return 350;
  return replyOpen ? 220 : 240;
}

export const chatColumnVariable = (side: ChatColumnSide) => `--chat-${side}-width`;

const validWidth = (side: ChatColumnSide, value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= CHAT_COLUMN_LIMITS[side].min &&
  value <= CHAT_COLUMN_LIMITS[side].max;

/** What was saved. Anything that isn't a width in range is dropped, so that column uses its default. */
export function parseChatColumnWidths(raw: string | null): ChatColumnWidths {
  let saved: unknown = null;
  try {
    saved = JSON.parse(raw ?? "null");
  } catch {
    return {};
  }
  if (!saved || typeof saved !== "object") return {};
  const { left, right } = saved as Record<string, unknown>;
  const widths: ChatColumnWidths = {};
  if (validWidth("left", left)) widths.left = left;
  if (validWidth("right", right)) widths.right = right;
  return widths;
}

/** The largest width a dragged column can have beside the other two as drawn. */
export function chatColumnMax(side: ChatColumnSide, total: number, otherWidth: number) {
  const { min, max } = CHAT_COLUMN_LIMITS[side];
  return Math.max(min, Math.min(max, total - CHAT_MIDDLE_MIN - otherWidth));
}

/**
 * Runs in the page before the chat is drawn, so saved widths are there on the first paint with no
 * jump. It sets the variables on <html>, whose attributes React leaves alone when hydrating
 * (app/layout.tsx suppresses that warning), so the server and client render the same markup.
 * parseChatColumnWidths is the same check; a unit test holds the two together.
 */
export const CHAT_COLUMN_WIDTHS_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(CHAT_COLUMN_STORAGE_KEY)})||"null"),l=${JSON.stringify(CHAT_COLUMN_LIMITS)};if(!s||typeof s!=="object")return;["left","right"].forEach(function(k){var v=s[k];if(typeof v==="number"&&isFinite(v)&&v>=l[k].min&&v<=l[k].max)document.documentElement.style.setProperty("--chat-"+k+"-width",v+"px")})}catch(e){}})()`;
