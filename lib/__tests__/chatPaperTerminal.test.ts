// #464 Paper Terminal: every colour it draws text in must pass WCAG AA (4.5:1) on the salmon paper
// it sits on. This reads the colours that ship (the CSS files themselves, not a copy), like
// chatPalettes.test.ts does for the colour combinations, and measures each pairing the WCAG way.
// Run with CHAT_PALETTE_REPORT=1 to print every number.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_THEME_VALUES } from "@/lib/chatTheme";

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pageCss = read("components/chat/PublicChat.module.css");
const tableCss = read("components/chat/ChatGainersTable.module.css");

type Rgb = [number, number, number];
/** Every `selector { declarations }` in a stylesheet (nested @media blocks are not needed here). */
function rule(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().replace(/\s+/g, " ") !== selector) continue;
    found = true;
    for (const part of match[2].split(";")) {
      const at = part.indexOf(":");
      if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
  }
  expect(found, `${selector} is in the stylesheet`).toBe(true);
  return out;
}
function hex(value: string): Rgb {
  const full = value.trim().toLowerCase().match(/^#([0-9a-f]{6})$/)?.[1];
  if (!full) throw new Error(`not a #rrggbb colour: ${value}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}
/** An rgba() tint drawn over an opaque colour. */
function over(value: string, under: Rgb): Rgb {
  const m = value.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  if (!m) throw new Error(`not an rgba() colour: ${value}`);
  const a = Number(m[4]);
  return [0, 1, 2].map((i) => Number(m[i + 1]) * a + under[i] * (1 - a)) as Rgb;
}
/** color-mix(in srgb, a share%, b). */
const mix = (a: Rgb, share: number, b: Rgb): Rgb => [0, 1, 2].map((i) => a[i] * share + b[i] * (1 - share)) as Rgb;
function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SELECTOR = ':is(.page, .themeScope)[data-theme="paper-terminal"]';
const tokens = rule(pageCss, SELECTOR);
const t = (name: string) => hex(tokens[name]);
const panel = t("--chat-panel"),
  page = t("--chat-bg"),
  raised = t("--chat-panel-raised"),
  selected = t("--chat-term-select"),
  tint = over(tokens["--chat-palm-soft"], panel);
/** Every salmon surface text sits on: the panel, the page around it, raised rows, the selected block, a hover tint. */
const papers: Record<string, Rgb> = { panel, page, raised, selected, tint };

const TEXT = 4.5;
const ratios: Record<string, number> = {};
const check = (name: string, fg: Rgb, bg: Rgb) => (ratios[name] = contrast(fg, bg));

for (const [where, paper] of Object.entries(papers)) {
  check(`text on ${where}`, t("--chat-text"), paper);
  check(`labels on ${where}`, t("--chat-muted"), paper);
  check(`teal links and focus on ${where}`, t("--chat-palm"), paper);
  check(`claret on ${where}`, t("--chat-palm-fill"), paper);
  check(`Gainers green on ${where}`, t("--chat-success"), paper);
  check(`Gainers red and errors on ${where}`, t("--chat-error"), paper);
  check(`draft tag on ${where}`, t("--chat-draft"), paper);
}
// Filled things: Send, unread counts, the main buttons.
check("white on the claret fill", t("--chat-on-fill"), t("--chat-palm-fill"));
// Mentions: claret on its own light claret tint.
const mention = rule(pageCss, `${SELECTOR} .mention`);
expect(mention.color).toBe("var(--chat-palm-fill)");
check("mention on its tint", t("--chat-palm-fill"), over(mention.background, panel));
// Gainers Table country blocks (#451): CN/HK red with white letters; any other country (US) grey.
const red = rule(tableCss, ".countryRed");
check("CN/HK block", hex(red.color === "#fff" ? "#ffffff" : red.color), hex(red.background));
const grey = rule(tableCss, ".countryCode");
expect(grey.background).toBe("color-mix(in srgb, var(--chat-muted) 22%, var(--chat-panel))");
check("US block", t("--chat-muted"), mix(t("--chat-muted"), 0.22, panel));
// #458's amber overseas marker, Paper Terminal's own deeper amber.
const nexus = rule(tableCss, '[data-theme="paper-terminal"] .nexusButton');
check("overseas marker", hex(nexus.color), hex(nexus.background));
check("overseas marker on a hovered row's panel", hex(nexus.color), selected);
// DM bubbles: received a raised block; yours tinted 9% with the sent colour (DirectInbox.module.css).
const received = t("--chat-dm-received-bg"),
  sent = mix(t("--chat-dm-sent-bg"), 0.09, received);
for (const [where, bubble] of Object.entries({ received, sent })) {
  check(`DM text (${where})`, t("--chat-dm-received-text"), bubble);
  check(`DM labels (${where})`, t("--chat-dm-received-muted"), bubble);
  check(`DM links (${where})`, t("--chat-dm-received-link"), bubble);
  check(`DM red (${where})`, t("--chat-error"), bubble);
}

if (process.env.CHAT_PALETTE_REPORT)
  console.log(Object.entries(ratios).map(([name, ratio]) => `${name.padEnd(44)}${ratio.toFixed(2)}`).join("\n"));

describe("Paper Terminal (#464)", () => {
  it("is listed as a theme", () => {
    expect(CHAT_THEME_VALUES).toContain("paper-terminal");
  });

  it("is light salmon paper with near-black ink", () => {
    expect(luminance(panel)).toBeGreaterThan(0.8);
    expect(luminance(page)).toBeLessThan(luminance(panel));
    expect(luminance(t("--chat-text"))).toBeLessThan(0.05);
  });

  it.each(Object.keys(ratios))("%s passes WCAG AA", (name) => {
    expect(ratios[name], `${name} ${ratios[name].toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT);
  });

  it("keeps Gainers green, red and the claret apart from each other", () => {
    // Different hues, not just different shades: green against red, and red against claret.
    expect(t("--chat-success")[1]).toBeGreaterThan(t("--chat-success")[0]);
    expect(t("--chat-error")[0]).toBeGreaterThan(t("--chat-error")[2] + 120);
    expect(t("--chat-palm-fill")[2]).toBeGreaterThan(t("--chat-error")[2]);
  });
});
