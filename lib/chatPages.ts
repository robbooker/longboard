// LB-PAGES (#321): the chat sidebar's Pages section. Pages are rows in chat_pages: an embedded
// website ("embed"), a shared list of links anyone can add to ("links"), or the built-in private
// list each trader keeps ("my-links"). This file is shared by the routes and the browser, so it
// holds only plain validation and types.

export type ChatPageKind = "embed" | "links" | "my-links";

export type ChatPage = {
  id: string;
  slug: string;
  name: string;
  kind: ChatPageKind;
  /** Only for "embed" pages. */
  embedUrl: string | null;
  builtIn: boolean;
};

export type ChatPageLink = {
  id: string;
  title: string;
  url: string;
  note: string | null;
  pinned: boolean;
  addedBy: string | null;
  /** The adder's chat name. On My Links, the original poster's, if it was saved from a shared list (#339). */
  addedByName: string | null;
  /** The viewer may edit or remove it (the adder or an admin). */
  canEdit: boolean;
  createdAt: string;
  /** #323: how many members like it (shared lists only; 0 on My Links). */
  likeCount: number;
  /** #323: the viewer likes it. */
  likedByMe: boolean;
  /** #323: the viewer added it (so can't like it). */
  addedByMe: boolean;
};

/**
 * #329: a member's page suggestion that isn't in the sidebars: "pending" until an admin decides,
 * "declined" until the member dismisses it. Approved suggestions are plain ChatPages.
 */
export type ChatPageSuggestion = {
  id: string;
  name: string;
  kind: "embed" | "links";
  /** Only for "embed" suggestions. */
  embedUrl: string | null;
  status: "pending" | "declined";
  /** The suggester's chat name (only on the admins' waiting list). */
  suggestedByName: string | null;
  createdAt: string;
};

/** #329: how many pages one member can have waiting (the database enforces it). */
export const MAX_PENDING_PAGE_SUGGESTIONS = 3;

/** #323: how a shared list is ordered. "top" (the default) ranks by likes; "new" is newest first. */
export type LinkSort = "top" | "new";

/** The shared page that "Share" copies a private link to. */
export const TRADER_LINKS_SLUG = "trader-links";

export const LINK_TITLE_MAX = 80;
export const LINK_NOTE_MAX = 140;
export const LINK_URL_MAX = 2048;
export const PAGE_NAME_MAX = 40;

export const HTTPS_ONLY_ERROR = "Only secure web addresses can be saved. Start the address with https://";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A trimmed https:// address with a real host and no sign-in details, or a clear error. */
export function parseHttpsUrl(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: "Add a web address." };
  const text = value.trim();
  if (text.length > LINK_URL_MAX) return { ok: false, error: "That web address is too long." };
  if (/\s/.test(text)) return { ok: false, error: "A web address cannot contain spaces." };
  if (!/^https:\/\//i.test(text)) return { ok: false, error: HTTPS_ONLY_ERROR };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:") return { ok: false, error: HTTPS_ONLY_ERROR };
  if (url.username || url.password)
    return { ok: false, error: "Remove the user name or password from the web address." };
  const host = url.hostname;
  // A real site name (example.com) or an address; not "localhost" or a bare word.
  if (!host || (!host.includes(".") && !host.startsWith("["))) return { ok: false, error: "That doesn't look like a web address." };
  return { ok: true, value: url.toString() };
}

/** One line of text: whitespace collapsed, trimmed, length-checked. Empty is null when optional. */
function oneLine(value: unknown, label: string, max: number, optional: boolean): Parsed<string | null> {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return optional ? { ok: true, value: null } : { ok: false, error: `Add a ${label}.` };
  }
  if (typeof value !== "string") return { ok: false, error: `That ${label} can't be saved.` };
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max) return { ok: false, error: `Keep the ${label} to ${max} characters or fewer.` };
  return { ok: true, value: text };
}

export type LinkInput = { title: string; url: string; note: string | null };

/** Title, https address and an optional one-line note, as typed by a member. */
export function parseLinkInput(body: unknown): Parsed<LinkInput> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = oneLine(input.title, "title", LINK_TITLE_MAX, false);
  if (!title.ok) return title;
  const url = parseHttpsUrl(input.url);
  if (!url.ok) return url;
  const note = oneLine(input.note, "note", LINK_NOTE_MAX, true);
  if (!note.ok) return note;
  return { ok: true, value: { title: title.value!, url: url.value, note: note.value } };
}

export type PageInput = { name: string; kind: "embed" | "links"; embedUrl: string | null };

/**
 * A page an admin adds or a member suggests (#329): a name and either an embedded website or a list of links. Embedded pages
 * are https only and may not show this site itself (a framed copy of the chat could act as the
 * signed-in member).
 */
export function parsePageInput(body: unknown, ownHosts: string[] = []): Parsed<PageInput> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = oneLine(input.name, "page name", PAGE_NAME_MAX, false);
  if (!name.ok) return name;
  if (input.kind === "links") return { ok: true, value: { name: name.value!, kind: "links", embedUrl: null } };
  if (input.kind !== "embed") return { ok: false, error: "Choose an embedded website or a list of links." };
  const url = parseHttpsUrl(input.embedUrl);
  if (!url.ok) return url;
  const host = new URL(url.value).hostname.toLowerCase();
  if (ownHosts.some((own) => own.toLowerCase().split(":")[0] === host))
    return { ok: false, error: "A page can't show the chat itself. Use another website." };
  return { ok: true, value: { name: name.value!, kind: "embed", embedUrl: url.value } };
}

/** A page's address-friendly name, made unique by the caller's suffix. */
export function pageSlug(name: string, suffix: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base || "page"}-${suffix}`;
}

/** Pages are for signed-in chat members of any tier (the same people as Social); not guests. */
export function canUseChatPages(access: { longboard: boolean; shortscout: boolean; shortscoutMember?: boolean }) {
  return access.longboard || access.shortscout || access.shortscoutMember === true;
}

/**
 * Pinned links first, in their own order (newest pinned first), whatever the sort. Below them:
 * "top" ranks by likes, most first, with ties newest first (#323); "new" is newest first.
 */
export function sortPageLinks<T extends { pinned: boolean; createdAt: string; likeCount?: number }>(
  links: T[],
  sort: LinkSort = "top",
) {
  return [...links].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (a.pinned || sort === "new" ? 0 : (b.likeCount ?? 0) - (a.likeCount ?? 0)) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/** #323: the link after the viewer likes it or takes the like back (the optimistic update). */
export function toggleLinkLike<T extends { likeCount: number; likedByMe: boolean }>(link: T, like: boolean): T {
  if (link.likedByMe === like) return link;
  return { ...link, likedByMe: like, likeCount: Math.max(0, link.likeCount + (like ? 1 : -1)) };
}
