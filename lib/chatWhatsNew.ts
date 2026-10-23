// #302 What's New: the automatic note posted when user-visible changes go live.
// The GitHub workflow (scripts/whats-new/post-whats-new.mjs) sends the plain-English
// "What's New:" lines of the PRs in a production deploy; this file checks and combines them.
import { createHash, timingSafeEqual } from "node:crypto";

export type WhatsNewChange = { pr: number; note: string; mergedAt: string | null };
export type WhatsNewRequest = { deployment: string; changes: WhatsNewChange[] };

/** A message body is at most 600 characters, like every other room message. */
export const WHATS_NEW_MAX_BODY = 600;
const MAX_NOTE = 280;
const MAX_CHANGES = 50;

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
    if (Object.keys(c).some((key) => !["pr", "note", "mergedAt"].includes(key))) return null;
    if (!Number.isSafeInteger(c.pr) || (c.pr as number) < 1 || (c.pr as number) > 1_000_000_000) return null;
    if (typeof c.note !== "string") return null;
    const note = clean(c.note);
    if (!note || Array.from(note).length > 2000) return null;
    let mergedAt: string | null = null;
    if (c.mergedAt !== undefined && c.mergedAt !== null) {
      if (typeof c.mergedAt !== "string" || !Number.isFinite(Date.parse(c.mergedAt))) return null;
      mergedAt = new Date(c.mergedAt).toISOString();
    }
    if (seen.has(c.pr as number)) continue;
    seen.add(c.pr as number);
    changes.push({ pr: c.pr as number, note: shorten(note, MAX_NOTE), mergedAt });
  }
  return { deployment: p.deployment, changes };
}

/**
 * One note for everything that went live together: the line itself for one change, bullets
 * for several, oldest merge first. Stays within one message; if it cannot, the rest are
 * summed up in a last line rather than dropped silently.
 */
export function composeWhatsNewNote(changes: WhatsNewChange[]) {
  const ordered = [...changes].sort(
    (a, b) => (a.mergedAt ? Date.parse(a.mergedAt) : 0) - (b.mergedAt ? Date.parse(b.mergedAt) : 0) || a.pr - b.pr,
  );
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
