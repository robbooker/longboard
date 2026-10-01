import { tokenizeChatMessage } from './boardroomChatLinks';

/** Keep draft previews aligned with posted-message link detection, without media fetching. */
export function chatComposerLinks(body: string): Array<{ href: string; label: string }> {
  const seen = new Set<string>();
  const links: Array<{ href: string; label: string }> = [];
  for (const part of tokenizeChatMessage(body)) {
    if (part.kind !== 'link') continue;
    try {
      const url = new URL(part.href);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || seen.has(url.href)) continue;
      seen.add(url.href);
      links.push({ href: url.href, label: part.value });
    } catch {
      // An unfinished or invalid URL stays in the text input until it is usable.
    }
  }
  return links;
}
