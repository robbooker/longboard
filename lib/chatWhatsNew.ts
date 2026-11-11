// #302 What's New: the automatic note posted when user-visible changes go live.
// The GitHub workflow (scripts/whats-new/post-whats-new.mjs) sends the plain-English
// "What's New:" lines of the PRs in a production deploy; this file checks and combines them.
import { createHash, timingSafeEqual } from "node:crypto";

export type WhatsNewChange = { pr: number; note: string; mergedAt: string | null; pictures?: string[] };
export type WhatsNewRequest = { deployment: string; changes: WhatsNewChange[] };
/** #443: pictures for a PR whose note is already posted (scripts/whats-new/post-pictures.mjs). */
export type WhatsNewFollowUp = { pr: number; pictures: string[] };

/** A message body is at most 600 characters, like every other room message. */
export const WHATS_NEW_MAX_BODY = 600;
const MAX_NOTE = 280;
const MAX_CHANGES = 50;
/** #443: at most 4 pictures per PR (docs/whats-new/<pr>/, see CLAUDE.md). */
export const WHATS_NEW_MAX_PICTURES_PER_PR = 4;
/** Every chat message holds at most 3 files (attachmentIds, bind_chat_attachments). */
export const WHATS_NEW_PICTURES_PER_MESSAGE = 3;
/** The largest picture file accepted for upload (the convention asks for about 500 KB). */
export const WHATS_NEW_PICTURE_MAX_BYTES = 600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validPr = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000_000;

/** Up to 4 distinct uploaded picture ids, or null when the list is malformed. */
function pictureIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > WHATS_NEW_MAX_PICTURES_PER_PR ||
    value.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    new Set(value).size !== value.length
  )
    return null;
  return value as string[];
}

export function whatsNewAuthorized(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(
    createHash("sha256").update(header.slice(7)).digest(),
    createHash("sha256").update(secret).digest(),
  );
}

const clean = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function shorten(text: string, limit: number) {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const cut = chars.slice(0, limit - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
}

export function parseWhatsNewRequest(value: unknown): WhatsNewRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => key !== "deployment" && key !== "changes")) return null;
  if (typeof p.deployment !== "string" || !/^[0-9a-f]{40}$/.test(p.deployment)) return null;
  if (!Array.isArray(p.changes) || p.changes.length < 1 || p.changes.length > MAX_CHANGES) return null;
  const seen = new Set<number>();
  const changes: WhatsNewChange[] = [];
  for (const item of p.changes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const c = item as Record<string, unknown>;
    if (Object.keys(c).some((key) => !["pr", "note", "mergedAt", "pictures"].includes(key))) return null;
    if (!validPr(c.pr)) return null;
    if (typeof c.note !== "string") return null;
    const note = clean(c.note);
    if (!note || Array.from(note).length > 2000) return null;
    let mergedAt: string | null = null;
    if (c.mergedAt !== undefined && c.mergedAt !== null) {
      if (typeof c.mergedAt !== "string" || !Number.isFinite(Date.parse(c.mergedAt))) return null;
      mergedAt = new Date(c.mergedAt).toISOString();
    }
    let pictures: string[] | null = [];
    if (c.pictures !== undefined && !(pictures = pictureIds(c.pictures))) return null;
    if (seen.has(c.pr as number)) continue;
    seen.add(c.pr as number);
    changes.push({
      pr: c.pr as number,
      note: shorten(note, MAX_NOTE),
      mergedAt,
      ...(pictures.length ? { pictures } : {}),
    });
  }
  const all = changes.flatMap((change) => change.pictures ?? []);
  if (new Set(all).size !== all.length) return null;
  return { deployment: p.deployment, changes };
}

/** #443: `{ followUp: { pr, pictures } }`, pictures for a PR that was already announced. */
export function parseWhatsNewFollowUp(value: unknown): WhatsNewFollowUp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => key !== "followUp")) return null;
  const f = p.followUp;
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const c = f as Record<string, unknown>;
  if (Object.keys(c).some((key) => key !== "pr" && key !== "pictures")) return null;
  const pictures = pictureIds(c.pictures);
  if (!validPr(c.pr) || !pictures?.length) return null;
  return { pr: c.pr, pictures };
}

const byMerge = (a: WhatsNewChange, b: WhatsNewChange) =>
  (a.mergedAt ? Date.parse(a.mergedAt) : 0) - (b.mergedAt ? Date.parse(b.mergedAt) : 0) || a.pr - b.pr;

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export type WhatsNewPictureMessage = { pr: number; body: string; files: string[] };

/**
 * #443: where each picture goes. The note itself carries the first 3 (the per-message limit),
 * oldest merge first; the rest go out right after it as follow-up messages of at most 3, one
 * PR per message, each naming the change it shows.
 */
export function planWhatsNewPictures(changes: WhatsNewChange[]) {
  const pictures = [...changes]
    .sort(byMerge)
    .flatMap((change) => (change.pictures ?? []).map((id) => ({ change, id })));
  const noteFiles = pictures.slice(0, WHATS_NEW_PICTURES_PER_MESSAGE).map((p) => p.id);
  const followUps: WhatsNewPictureMessage[] = [];
  const rest = pictures.slice(WHATS_NEW_PICTURES_PER_MESSAGE);
  for (const change of [...new Set(rest.map((p) => p.change))])
    for (const files of chunks(
      rest.filter((p) => p.change === change).map((p) => p.id),
      WHATS_NEW_PICTURES_PER_MESSAGE,
    ))
      followUps.push({ pr: change.pr, body: whatsNewPicturesBody(change.note, true), files });
  return { noteFiles, followUps };
}

/** The text above pictures posted apart from their note. */
export function whatsNewPicturesBody(note: string, more = false) {
  return shorten(`${more ? "More pictures" : "Pictures"}: ${clean(note)}`, WHATS_NEW_MAX_BODY);
}

/** #443: pictures for an already-announced PR: messages of at most 3. */
export function planWhatsNewFollowUp(pr: number, note: string, pictures: string[]): WhatsNewPictureMessage[] {
  return chunks(pictures, WHATS_NEW_PICTURES_PER_MESSAGE).map((files, i) => ({
    pr,
    body: whatsNewPicturesBody(note, i > 0),
    files,
  }));
}

/**
 * The file name members see under a picture: its caption plus the extension. Control
 * characters, slashes and other path characters are dropped; at most 120 characters.
 */
export function whatsNewPictureFilename(caption: unknown, mime: "image/png" | "image/jpeg") {
  const text =
    typeof caption === "string"
      ? clean(caption)
          .replace(/[\\/:*?"<>|]/g, " ")
          .replace(/\s+/g, " ")
          .replace(/^[.\s]+|[.\s]+$/g, "")
      : "";
  const base = shorten(text || "Picture", 120);
  return `${base}.${mime === "image/png" ? "png" : "jpg"}`;
}

/**
 * One note for everything that went live together: the line itself for one change, bullets
 * for several, oldest merge first. Stays within one message; if it cannot, the rest are
 * summed up in a last line rather than dropped silently.
 */
export function composeWhatsNewNote(changes: WhatsNewChange[]) {
  const ordered = [...changes].sort(byMerge);
  if (ordered.length === 1) return shorten(ordered[0].note, WHATS_NEW_MAX_BODY);
  const head = "New on Longboard:";
  const lines: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const rest = ordered.length - i - 1;
    const line = `• ${ordered[i].note}`;
    const more = rest ? `\n• …and ${rest} more small improvement${rest === 1 ? "" : "s"}.` : "";
    const next = [head, ...lines, line].join("\n");
    if (Array.from(next + more).length > WHATS_NEW_MAX_BODY) {
      const left = ordered.length - i;
      lines.push(`• …and ${left} more small improvement${left === 1 ? "" : "s"}.`);
      break;
    }
    lines.push(line);
  }
  return [head, ...lines].join("\n");
}
