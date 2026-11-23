// #492/#493 Dual view: two chats side by side. It is always the person's choice: it is off until
// they open Dual view from the chat menu, and "Single chat" turns it off again. The choice is kept
// on this device. Dual view is offered only where two chats fit side by side (a laptop, a tablet,
// or a folding phone while it is open); a regular phone or a closed folding phone gets the normal
// single chat.

/** This device's choice: "dual" while Dual view is on. */
export const CHAT_VIEW_STORAGE_KEY = "rb-chat-view-v1";
/** Screens wide enough for two chats. Phones are under 450px; open folding phones are 670px or more. */
export const DUAL_VIEW_MEDIA = "(min-width: 600px)";

export function dualViewChosen(): boolean {
  try {
    return localStorage.getItem(CHAT_VIEW_STORAGE_KEY) === "dual";
  } catch {
    return false;
  }
}

export function chooseDualView(on: boolean) {
  try {
    if (on) localStorage.setItem(CHAT_VIEW_STORAGE_KEY, "dual");
    else localStorage.removeItem(CHAT_VIEW_STORAGE_KEY);
  } catch {}
}

/**
 * Runs before the single chat loads (only on a plain /chat with no link in it, so a notification
 * or a shared link still opens what it points at): with Dual view on and room for two chats, go
 * straight to Dual view instead of loading the single chat first.
 */
export const CHAT_DUAL_VIEW_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(CHAT_VIEW_STORAGE_KEY)})==="dual"&&matchMedia(${JSON.stringify(DUAL_VIEW_MEDIA)}).matches&&!location.search&&!location.hash)location.replace("/chat/dual")}catch(e){}})()`;
