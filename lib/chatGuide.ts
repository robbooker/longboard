import { readFileSync } from "node:fs";
import path from "node:path";

// #344: the chat guide, content/chat-guide.md, is the FAQ drafting AI's source for questions about the
// chat. Admins review it by reviewing the change that edits it. Comments are notes for those admins, and a
// "###" section with a NEEDS ADMIN line is a gap: both stay out of what the AI reads, so it can't guess
// from the note. Server-only: next.config.mjs ships the file with the routes that use it.

const GAP = /^NEEDS ADMIN:/m;
let cached: string | null = null;

/** The guide as the AI should read it. */
export function guideForDrafting(markdown: string) {
  const sections = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/^(?=#{1,3} )/m);
  return sections
    .filter((section) => !(section.startsWith("### ") && GAP.test(section)))
    .join("")
    .trim();
}

/** Throws when the file is missing, so a draft fails rather than running with no source. */
export function loadChatGuide() {
  if (cached === null) {
    const text = guideForDrafting(readFileSync(path.join(process.cwd(), "content/chat-guide.md"), "utf8"));
    if (!text) throw new Error("chat_guide_empty");
    cached = text;
  }
  return cached;
}
