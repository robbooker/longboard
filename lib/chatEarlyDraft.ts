// EARLY-TYPING: the server draws the composer before the page can take input, and hydrating
// a controlled textarea resets it to its initial value. This inline script runs before
// hydration and remembers what was typed, by composer label, so the composer can keep it.
type EarlyDraftWindow = Window & {
  __chatEarlyDrafts?: Record<string, string>;
  __chatEarlyInput?: (event: Event) => void;
};

export const CHAT_EARLY_DRAFT_SCRIPT = `(function(){var w=window;w.__chatEarlyDrafts={};w.__chatEarlyInput=function(e){var t=e.target;if(t&&t.matches&&t.matches("textarea[data-chat-composer]"))w.__chatEarlyDrafts[t.getAttribute("aria-label")]=t.value};addEventListener("input",w.__chatEarlyInput,true)})()`;

/** What the composer with this label held after typing before hydration (null if untouched), once; stops recording. */
export function takeEarlyDraft(label: string): string | null {
  const w = window as EarlyDraftWindow;
  if (w.__chatEarlyInput) {
    removeEventListener("input", w.__chatEarlyInput, true);
    delete w.__chatEarlyInput;
  }
  const text = w.__chatEarlyDrafts?.[label] ?? null;
  delete w.__chatEarlyDrafts?.[label];
  return text;
}
