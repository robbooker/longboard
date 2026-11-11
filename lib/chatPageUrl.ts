// #441: the address bar follows the page on screen. A page's name in /chat?page=<name> is its own id
// for the pages built into the chat (FAQ, Gainers Table, News Feed, Reader, the add and waiting
// forms) and its slug for a page made in the Pages admin. These turn one into the other.

type NamedPage = { id: string; slug: string };

/** The ?page= name of an open page, or null while a made page isn't known yet. */
export function chatPageName(
  id: string,
  pages: readonly NamedPage[] | null | undefined,
  builtIn: readonly string[],
): string | null {
  if (builtIn.includes(id)) return id;
  return pages?.find((page) => page.id === id)?.slug ?? null;
}

/** The page a ?page= name opens, or null when it names no page this member has. */
export function chatPageId(
  name: string,
  pages: readonly NamedPage[] | null | undefined,
  builtIn: readonly string[],
): string | null {
  if (builtIn.includes(name)) return name;
  return pages?.find((page) => page.slug === name)?.id ?? null;
}
