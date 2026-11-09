// #385 Reader: strips anything active out of an EPUB chapter before it is shown. The chapter is also
// drawn in an iframe sandboxed without allow-scripts (epub.js's default, which we never change), so
// this is the second lock, not the only one: no scripts, frames, plugins, forms, refreshes, event
// handler attributes or javascript: links survive either way.

const REMOVE = "script, iframe, frame, frameset, object, embed, applet, form, portal, meta[http-equiv]";
const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "poster", "data"];

export function sanitizeEpubDocument(doc: Document): number {
  let removed = 0;
  for (const node of Array.from(doc.querySelectorAll(REMOVE))) {
    node.remove();
    removed++;
  }
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
      const dangerousUrl =
        URL_ATTRS.includes(name) && (value.startsWith("javascript:") || value.startsWith("vbscript:") || value.startsWith("data:text/html"));
      if (name.startsWith("on") || name === "srcdoc" || dangerousUrl) {
        element.removeAttribute(attr.name);
        removed++;
      }
    }
  }
  return removed;
}
