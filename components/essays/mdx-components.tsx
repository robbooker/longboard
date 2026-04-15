import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Authored pullquote. Breaks out of the article column into the right
 *  margin on desktop (negative right margin), falls back inline on
 *  mobile via the scoped media query. Quotes are drawn by the CSS
 *  pseudo-elements, so the author just writes prose. */
function Pullquote({ children }: { children: ReactNode }) {
  return <div className="pullquote">{children}</div>;
}

/** Numbered stack of maxims. Decimal-leading-zero counters come from
 *  CSS (counter-reset: maxim on the stack, counter-increment on each
 *  maxim ::before). Authors write:
 *    <MaximStack>
 *      <Maxim>…</Maxim>
 *      <Maxim>…</Maxim>
 *    </MaximStack>
 */
function MaximStack({ children }: { children: ReactNode }) {
  return <div className="maxim-stack">{children}</div>;
}

/** Single maxim. Renders the same `.maxim` paragraph whether it sits
 *  standalone (full-width border + padding) or inside a MaximStack
 *  (smaller, numbered, no border) — the CSS cascade handles both
 *  contexts via `.maxim-stack .maxim` overrides. */
function Maxim({ children }: { children: ReactNode }) {
  return <p className="maxim">{children}</p>;
}

/** Section dinkus. Three moss fleurons with wide tracking. */
function Break() {
  return <div className="break">\u273B \u273B \u273B</div>;
}

/** The canonical component map handed to <MDXRemote components={…}>.
 *  Markdown elements pass through untouched — all the styling lives in
 *  the scoped stylesheet (drop cap, roman-numeral h2 counters, body
 *  font/measure). Named components are what the author reaches for
 *  when they want editorial chrome. */
export const essayMdxComponents = {
  // Passthroughs — named explicitly so the component map is the single
  // source of truth for what MDX can render inside an essay body.
  h2: (props: ComponentPropsWithoutRef<"h2">) => <h2 {...props} />,
  p: (props: ComponentPropsWithoutRef<"p">) => <p {...props} />,
  em: (props: ComponentPropsWithoutRef<"em">) => <em {...props} />,
  strong: (props: ComponentPropsWithoutRef<"strong">) => <strong {...props} />,
  a: (props: ComponentPropsWithoutRef<"a">) => <a {...props} />,

  // Editorial chrome.
  Pullquote,
  MaximStack,
  Maxim,
  Break,
};
