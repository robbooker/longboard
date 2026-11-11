// #420: every colour combination must be readable. This reads the colours that ship (the CSS files
// themselves, not a copy) and measures contrast the WCAG way. Run with CHAT_PALETTE_REPORT=1 to
// print every number.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_PALETTES, CHAT_THEME_VALUES } from "@/lib/chatTheme";

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const paletteCss = read("components/chat/chatPalettes.css");
const pageCss = read("components/chat/PublicChat.module.css");
const dmCss = read("components/chat/DirectInbox.module.css");
const tableCss = read("components/chat/ChatGainersTable.module.css");

type Tokens = Record<string, string>;
type Rgba = [number, number, number, number];
/** Every `selector { declarations }` in a stylesheet, in order (nested @media blocks are not needed here). */
function blocks(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, " "),
    body: match[2],
  }));
}
function declarations(body: string): Tokens {
  const out: Tokens = {};
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}
/** The custom properties a selector sets, over every block with exactly that selector. */
function tokensOf(css: string, selector: string): Tokens {
  const out: Tokens = {};
  for (const block of blocks(css)) if (block.selector === selector) Object.assign(out, declarations(block.body));
  return out;
}
function rule(css: string, selector: string): Tokens {
  const found = blocks(css).filter((block) => block.selector === selector);
  expect(found.length, `${selector} is in the stylesheet`).toBeGreaterThan(0);
  return Object.assign({}, ...found.map((block) => declarations(block.body)));
}

function colour(value: string): Rgba {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  if (text === "white") return [255, 255, 255, 1];
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`not a colour this test understands: ${value}`);
}
/** `top` drawn over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as Rgba;
}
const mix = (a: Rgba, share: number, b: Rgba): Rgba =>
  [0, 1, 2].map((i) => a[i] * share + b[i] * (1 - share)).concat(1) as Rgba;
function luminance(c: Rgba): number {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = tokensOf(pageCss, ".page, .themeScope");
const LIGHT = { ...DARK, ...tokensOf(pageCss, ':is(.page, .themeScope)[data-theme="light"]') };
const PALETTE_SELECTOR = /^\[data-palette="([a-z0-9-]+)"\]\[data-theme="(dark|light)"\]\[data-palette\]$/;
const paletteBlocks = blocks(paletteCss).map((block) => {
  const match = block.selector.match(PALETTE_SELECTOR);
  return { ...block, id: match?.[1], base: match?.[2], own: declarations(block.body) };
});
/** The colours a combination allows itself to change; it must set every one of them. */
const PALETTE_TOKENS = [
  "--chat-bg",
  "--chat-panel",
  "--chat-panel-raised",
  "--chat-line",
  "--chat-text",
  "--chat-muted",
  "--chat-dim",
  "--chat-palm",
  "--chat-palm-fill",
  "--chat-palm-soft",
  "--chat-success",
  "--chat-error",
  "--chat-draft",
  "--chat-header",
  "--chat-composer",
  "--chat-shadow",
  "--chat-glow",
];

/** Text colours written into the stylesheets rather than taken from a token. */
const onAccent = rule(pageCss, ".primaryButton").color; // on the accent-filled buttons (Send, reactions you added)
const onSuccess = rule(pageCss, '.primaryButton[data-state="success"]').color;

/**
 * Every pairing the chat draws with these tokens, as contrast ratios. `tokens` is the full set a
 * themed element ends up with (the base theme, then the combination on top).
 */
function measure(tokens: Tokens): Record<string, number> {
  const c = (name: string) => colour(tokens[name]);
  const bg = c("--chat-bg"),
    panel = over(c("--chat-panel"), bg),
    raised = over(c("--chat-panel-raised"), bg),
    header = over(c("--chat-header"), bg),
    composer = over(c("--chat-composer"), bg),
    selected = over(c("--chat-palm-soft"), panel),
    selectedOnBg = over(c("--chat-palm-soft"), bg);
  // A DM bubble is the same pale card in every standard look (DirectInbox.module.css remaps the
  // text, muted and link colours inside it); the look's own red still shows there.
  const received = c("--chat-dm-received-bg"),
    sent = mix(c("--chat-dm-sent-bg"), 0.09, received);
  const least = (...values: number[]) => Math.min(...values);
  return {
    "text on background": contrast(c("--chat-text"), bg),
    "text on panel": contrast(c("--chat-text"), panel),
    "text on raised panel (message box)": contrast(c("--chat-text"), raised),
    "text on header and composer bar": least(contrast(c("--chat-text"), header), contrast(c("--chat-text"), composer)),
    "text on selected row": least(contrast(c("--chat-text"), selected), contrast(c("--chat-text"), selectedOnBg)),
    "muted on background": contrast(c("--chat-muted"), bg),
    "muted on panel": contrast(c("--chat-muted"), panel),
    "muted on raised panel (placeholder)": contrast(c("--chat-muted"), raised),
    "accent/link on background": contrast(c("--chat-palm"), bg),
    "accent/link on panel": contrast(c("--chat-palm"), panel),
    "accent on its own soft tint": least(contrast(c("--chat-palm"), selected), contrast(c("--chat-palm"), selectedOnBg)),
    "button text on accent fill": contrast(colour(onAccent), c("--chat-palm-fill")),
    "background-coloured text on accent": contrast(bg, c("--chat-palm")),
    "green on panel (Gainers up)": contrast(c("--chat-success"), panel),
    "red on panel (Gainers down)": contrast(c("--chat-error"), panel),
    "green on hovered Gainers row": contrast(c("--chat-success"), selected),
    "red on hovered Gainers row": contrast(c("--chat-error"), selected),
    "green on background": contrast(c("--chat-success"), bg),
    "red on background": contrast(c("--chat-error"), bg),
    "button text on green": contrast(colour(onSuccess), c("--chat-success")),
    "draft tag on background and panel": least(contrast(c("--chat-draft"), bg), contrast(c("--chat-draft"), panel)),
    "line against panel": contrast(c("--chat-line"), panel),
    "line against background": contrast(c("--chat-line"), bg),
    "dim marks against panel": contrast(c("--chat-dim"), panel),
    "DM bubble text": least(
      contrast(c("--chat-dm-received-text"), received),
      contrast(c("--chat-dm-received-text"), sent),
    ),
    "DM bubble muted text": least(
      contrast(c("--chat-dm-received-muted"), received),
      contrast(c("--chat-dm-received-muted"), sent),
    ),
    "DM bubble link (and green)": least(
      contrast(c("--chat-dm-received-link"), received),
      contrast(c("--chat-dm-received-link"), sent),
    ),
    "DM bubble red": least(contrast(c("--chat-error"), received), contrast(c("--chat-error"), sent)),
    // Conversations are drawn on the panel.
    "DM bubble edge against the panel": Math.max(
      contrast(received, panel),
      contrast(c("--chat-dm-received-border"), panel),
    ),
  };
}

const looks: Array<{ name: string; tokens: Tokens }> = [
  { name: "Dark", tokens: DARK },
  { name: "Light", tokens: LIGHT },
  ...paletteBlocks.map((block) => ({
    name: CHAT_PALETTES.find((palette) => palette.id === block.id)?.label ?? String(block.id),
    tokens: { ...(block.base === "light" ? LIGHT : DARK), ...block.own },
  })),
];
const measured = looks.map((look) => ({ ...look, ratios: measure(look.tokens) }));
const dark = measured[0].ratios,
  light = measured[1].ratios;
const palettes = measured.slice(2);
/** The weaker of today's Dark and Light for a pairing: a combination may not do worse. */
const today = (pairing: string) => Math.min(dark[pairing], light[pairing]);

if (process.env.CHAT_PALETTE_REPORT) {
  const names = Object.keys(dark);
  const rows = names.map((pairing) => `${pairing.padEnd(40)}${measured.map((look) => look.ratios[pairing].toFixed(2).padStart(8)).join("")}`);
  console.log([`${"".padEnd(40)}${measured.map((look) => look.name.slice(0, 7).padStart(8)).join("")}`, ...rows].join("\n"));
}

describe("the list of combinations and the stylesheet agree (#420)", () => {
  it("has one block per listed combination, on the base the list names", () => {
    for (const block of paletteBlocks)
      expect(block.id, `"${block.selector}" is not a combination selector`).toBeTruthy();
    expect(paletteBlocks.map((block) => `${block.id}:${block.base}`)).toEqual(
      CHAT_PALETTES.map((palette) => `${palette.id}:${palette.base}`),
    );
  });

  it("names nothing twice and nothing a theme is called", () => {
    const ids = CHAT_PALETTES.map((palette) => palette.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CHAT_PALETTES.map((palette) => palette.label)).size).toBe(ids.length);
    for (const id of ids) {
      expect(CHAT_THEME_VALUES as string[]).not.toContain(id);
      // The account column accepts this shape only (migration 20261110220000_chat_theme_palette.sql).
      expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
    }
  });

  it("changes colours only, and the same set of them in every combination", () => {
    for (const block of paletteBlocks) {
      expect(Object.keys(block.own), block.id).toEqual(PALETTE_TOKENS);
      for (const value of Object.values(block.own)) expect(() => colour(value)).not.toThrow();
    }
  });

  it("draws the page glow, Gainers green and red and DM bubbles from the tokens measured here", () => {
    expect(pageCss).toContain("var(--chat-glow, rgba(101, 214, 138, 0.12))");
    expect(rule(tableCss, ".table .up").color).toBe("var(--chat-success)");
    expect(rule(tableCss, ".table .down").color).toBe("var(--chat-error)");
    const bubble = rule(dmCss, ".message");
    expect(bubble["--chat-text"]).toBe("var(--chat-dm-received-text)");
    expect(bubble["--chat-muted"]).toBe("var(--chat-dm-received-muted)");
    expect(bubble["--chat-palm"]).toBe("var(--chat-dm-received-link)");
    expect(bubble["--chat-success"]).toBe("var(--chat-palm)");
    expect(bubble.background).toBe("var(--chat-panel-raised)");
    expect(bubble["--chat-panel-raised"]).toBe("var(--chat-dm-received-bg)");
  });
});

/** WCAG AA for text; 3:1 for large text and marks that carry meaning. */
const TEXT = 4.5,
  MARK = 3;
describe("Dark and Light stay readable (#420)", () => {
  it.each(measured.slice(0, 2))("$name", ({ ratios }) => {
    for (const pairing of [
      "text on background",
      "text on panel",
      "text on raised panel (message box)",
      "text on header and composer bar",
      "text on selected row",
      "muted on background",
      "muted on panel",
      "muted on raised panel (placeholder)",
      "accent/link on background",
      "accent/link on panel",
      "button text on accent fill",
      "background-coloured text on accent",
      "green on panel (Gainers up)",
      "red on panel (Gainers down)",
      "DM bubble text",
      "DM bubble muted text",
      "DM bubble link (and green)",
    ])
      expect(ratios[pairing], pairing).toBeGreaterThanOrEqual(TEXT);
  });
});

describe("every combination is readable (#420)", () => {
  it.each(palettes)("$name", ({ ratios }) => {
    for (const pairing of [
      "text on background",
      "text on panel",
      "text on raised panel (message box)",
      "text on header and composer bar",
      "text on selected row",
      "muted on background",
      "muted on panel",
      "muted on raised panel (placeholder)",
      "accent/link on background",
      "accent/link on panel",
      "accent on its own soft tint",
      "button text on accent fill",
      "background-coloured text on accent",
      "green on panel (Gainers up)",
      "red on panel (Gainers down)",
      "green on background",
      "red on background",
      "DM bubble text",
      "DM bubble muted text",
      "DM bubble link (and green)",
    ])
      expect(ratios[pairing], pairing).toBeGreaterThanOrEqual(TEXT);
    expect(ratios["button text on green"], "button text on green").toBeGreaterThanOrEqual(MARK);
    // Where Dark or Light are below the usual bar today, a combination may not do worse than them.
    for (const pairing of [
      "green on hovered Gainers row",
      "red on hovered Gainers row",
      "draft tag on background and panel",
      "line against panel",
      "line against background",
      "dim marks against panel",
      // The look's own red shows inside the pale DM bubble too.
      "DM bubble red",
    ])
      expect(ratios[pairing], pairing).toBeGreaterThanOrEqual(today(pairing));
    // The bubble's outline shows at least as clearly as the faintest line the chat draws today.
    expect(ratios["DM bubble edge against the panel"], "DM bubble edge").toBeGreaterThanOrEqual(
      today("line against panel"),
    );
  });
});
