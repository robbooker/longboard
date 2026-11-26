// #510: stage mode (the webinar screen and the phone viewing room) follows the member's theme. Its
// stylesheets map every stage colour onto the chat's theme tokens. This reads the stylesheets that
// ship (not a copy), works out each stage colour in every look the chat offers (the five themes and
// every colour combination) and measures the pairings the stage draws the WCAG way. It also holds
// the mapping in place: themed colours come from tokens, and the video's surround stays dark.
// Run with CHAT_STAGE_REPORT=1 to print every number.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_PALETTES, CHAT_THEME_VALUES } from "@/lib/chatTheme";

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pageCss = read("components/chat/PublicChat.module.css");
const paletteCss = read("components/chat/chatPalettes.css");
const stageCss = read("components/chat/stage/StageMode.module.css");
const handsCss = read("components/chat/stage/StageHands.module.css");
const phoneCss = read("components/chat/stage/StagePhone.module.css");
const cardsCss = read("components/chat/cards/cards.module.css");

type Tokens = Record<string, string>;
type Rgba = [number, number, number, number];
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
/** What a selector sets, over every block with exactly that selector (the last one wins). */
function tokensOf(css: string, selector: string): Tokens {
  const found = blocks(css).filter((block) => block.selector === selector);
  expect(found.length, `${selector} is in the stylesheet`).toBeGreaterThan(0);
  return Object.assign({}, ...found.map((block) => declarations(block.body)));
}

/** Splits `a, b(c, d), e` at its top-level commas. */
function split(text: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return [...parts, text.slice(from).trim()];
}
/** The text inside the brackets that open at `open`, and where they close. */
function inside(text: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  throw new Error(`unbalanced brackets: ${text}`);
}
/** A value with every var() replaced by what `tokens` holds (else its fallback). */
function resolve(value: string, tokens: Tokens, depth = 0): string {
  if (depth > 12) throw new Error(`a token refers to itself: ${value}`);
  let out = value;
  for (let at = out.indexOf("var("); at >= 0; at = out.indexOf("var(")) {
    const { body, end } = inside(out, at + 3);
    const [name, ...fallback] = split(body);
    const found = tokens[name] ?? (fallback.length ? fallback.join(", ") : undefined);
    if (found === undefined) throw new Error(`${name} is not set and has no fallback (in ${value})`);
    out = out.slice(0, at) + resolve(found, tokens, depth + 1) + out.slice(end + 1);
  }
  return out;
}
function colour(value: string): Rgba {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  if (text.startsWith("color-mix(")) {
    // color-mix(in srgb, A p%, B): p% of A, the rest B (both opaque here).
    const [space, first, second] = split(inside(text, text.indexOf("(")).body);
    const share = first.match(/^(.*\S)\s+([\d.]+)%$/);
    if (space !== "in srgb" || !share) throw new Error(`not a mix this test understands: ${value}`);
    const a = colour(share[1]),
      b = colour(second),
      p = Number(share[2]) / 100;
    if (a[3] !== 1 || b[3] !== 1) throw new Error(`a mix of see-through colours: ${value}`);
    return [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)).concat(1) as Rgba;
  }
  throw new Error(`not a colour this test understands: ${value}`);
}
/** `top` drawn over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as Rgba;
}
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
const BLACK: Rgba = [0, 0, 0, 1],
  WHITE: Rgba = [255, 255, 255, 1];

// Every look the chat offers, as the full set of chat tokens a themed page ends up with.
const DARK = tokensOf(pageCss, ".page, .themeScope");
const themeTokens = (theme: string): Tokens => ({
  ...DARK,
  ...(theme === "dark" ? {} : tokensOf(pageCss, `:is(.page, .themeScope)[data-theme="${theme}"]`)),
});
const LOOKS: Array<{ id: string; light: boolean; tokens: Tokens }> = [
  ...CHAT_THEME_VALUES.map((theme) => ({
    id: theme,
    light: theme === "light" || theme === "paper-terminal",
    tokens: themeTokens(theme),
  })),
  ...CHAT_PALETTES.map((palette) => ({
    id: palette.id,
    light: palette.base === "light",
    tokens: {
      ...themeTokens(palette.base),
      ...tokensOf(paletteCss, `[data-palette="${palette.id}"][data-theme="${palette.base}"][data-palette]`),
    },
  })),
];

const STAGE_SCOPE = ":global(main[data-stage]):has(.root)";
const stageTokens = tokensOf(stageCss, STAGE_SCOPE);
const playerTokens = tokensOf(stageCss, ".player");
const phoneTokens = tokensOf(phoneCss, STAGE_SCOPE);
const phoneLandscape = tokensOf(phoneCss, ".root ~ section, .root ~ aside");
const names = (tokens: Tokens, prefix: string) => Object.keys(tokens).filter((name) => name.startsWith(prefix));

/** The computer stage's pairings in one look. Text needs 4.5:1; the last group (shapes) 3:1. */
function measureStage(chat: Tokens): { text: Record<string, number>; shapes: Record<string, number> } {
  const all = { ...chat, ...stageTokens };
  const c = (name: string) => colour(resolve(all[name], all));
  const page = c("--stage-page"),
    panel = c("--stage-panel"),
    raised = c("--stage-panel-2"),
    card = c("--stage-card"),
    control = c("--stage-control"),
    soft = c("--stage-accent-soft"),
    tapeLatest = colour(resolve(tokensOf(stageCss, ".tape li[data-latest]").background, all));
  const least = (colourName: string, ...grounds: Rgba[]) => Math.min(...grounds.map((ground) => contrast(c(colourName), ground)));
  return {
    text: {
      "text on the page, panels, cards and buttons": least("--stage-text", page, panel, raised, card, control),
      "small tags (US, WATCH: text on the line colour)": least("--stage-text", c("--stage-line")),
      "secondary text and labels on the page, panels, cards and buttons (also placeholders and switched-off buttons)": least("--stage-text-2", page, panel, raised, card, control),
      "labels (same surfaces)": least("--stage-label", page, panel, raised, card, control),
      "links, the hands count and the accent on panels": least("--stage-accent", panel, raised, card),
      "a selected chip, chapter, button or vote, and the first hand in the list (text and labels on the accent's tint)": Math.min(least("--stage-text", soft), least("--stage-text-2", soft), least("--stage-label", soft)),
      "the “on screen” chip and filled buttons (text on the accent fill)": contrast(c("--stage-on-accent"), c("--stage-accent-fill")),
      "the newest sample trade (text and secondary text on its tint)": Math.min(least("--stage-text", tapeLatest), least("--stage-text-2", tapeLatest)),
      "a gain (green percent) on panels": least("--stage-positive", panel, raised),
      "a loss (red percent) and errors on panels": least("--stage-negative", panel, raised, tapeLatest),
      "LIVE and End live video (white on the live red)": contrast(c("--stage-on-live"), c("--stage-live")),
    },
    shapes: {
      "focus ring on the page and panels": least("--stage-focus", page, panel, raised),
    },
  };
}
/** The player's fixed dark pairings (the same in every look). */
function measurePlayer(): { text: Record<string, number>; shapes: Record<string, number> } {
  const c = (name: string) => colour(resolve(playerTokens[name], playerTokens));
  const bar = c("--stage-video-bar"),
    picture = c("--stage-video"),
    // A switched-off control is drawn at 40%.
    off = over([...c("--stage-text").slice(0, 3), 0.4] as Rgba, bar),
    label = over(c("--stage-video-label"), WHITE);
  return {
    text: {
      "text on the title and control bars": contrast(c("--stage-text"), bar),
      "secondary text on the bars and the placeholder": Math.min(contrast(c("--stage-text-2"), bar), contrast(c("--stage-text-2"), picture)),
      "small labels on the title bar": contrast(c("--stage-label"), bar),
      "the placeholder's text": Math.min(contrast(c("--stage-video-note"), picture), contrast(c("--stage-text"), picture)),
      "LIVE on the player (dark on the lighter live red)": contrast(c("--stage-on-live"), c("--stage-live")),
      "LIVE beside the scrub bar": contrast(c("--stage-live-soft"), bar),
      "the host's initials": contrast(c("--stage-accent"), c("--stage-accent-soft")),
      "Try again (dark on amber)": contrast(c("--stage-on-accent"), c("--stage-accent-fill")),
      "Tap for sound (dark on white)": contrast(c("--stage-video-ink"), c("--stage-video-white")),
      "a card's room name over a white picture": contrast(c("--stage-text"), label),
    },
    shapes: {
      "a switched-off control's icon": contrast(off, bar),
      "focus ring on the bars": contrast(c("--stage-focus"), bar),
      "the live red frame on black": contrast(c("--stage-live"), c("--stage-video-black")),
    },
  };
}
/** The phone viewing room's pairings in one look. */
function measurePhone(chat: Tokens): { text: Record<string, number>; shapes: Record<string, number> } {
  const all = { ...chat, ...phoneTokens };
  const c = (name: string) => colour(resolve(all[name], all));
  const page = c("--sp-page"),
    panel = c("--sp-panel"),
    bar = c("--sp-panel-2");
  // Phone on its side: the chat's own tokens are set again for the dark panel over the video.
  const side = { ...all, ...phoneLandscape };
  const s = (name: string) => colour(resolve(side[name], side));
  const scrims = [over(c("--sp-scrim"), WHITE), over(c("--sp-scrim"), BLACK)];
  const onScrim = (name: string) => Math.min(...scrims.map((ground) => contrast(s(name), ground)));
  return {
    text: {
      "messages over the video (waiting, ended)": Math.min(contrast(c("--sp-video-text"), page), contrast(c("--sp-video-text-2"), page)),
      "LIVE and the unread count (white on the live red)": contrast(c("--sp-on-red"), c("--sp-red")),
      "Back to the room (dark on amber)": contrast(c("--sp-video-ink"), c("--sp-video-accent")),
      "Tap for sound (dark on white)": contrast(c("--sp-video-ink"), c("--sp-video-white")),
      "the Chat button over a white picture": contrast(c("--sp-video-white"), over(c("--sp-video-button"), WHITE)),
      "upright: the strip above the chat (room name, count)": Math.min(contrast(c("--sp-text"), bar), contrast(c("--sp-text-2"), bar)),
      "upright: chat text and labels on the panel": Math.min(contrast(c("--sp-text"), panel), contrast(c("--sp-text-2"), panel)),
      "on its side: chat text, labels, links and errors on the scrim": Math.min(onScrim("--chat-text"), onScrim("--chat-muted"), onScrim("--chat-dim"), onScrim("--chat-palm"), onScrim("--chat-error"), onScrim("--chat-success")),
      "on its side: Send (text on the accent fill)": contrast(s("--chat-on-fill"), s("--chat-palm-fill")),
    },
    shapes: {
      "upright: focus ring and icons on the strip": Math.min(contrast(c("--sp-focus"), bar), contrast(c("--sp-text"), bar)),
      "focus ring over the dark video": contrast(c("--sp-video-accent"), page),
    },
  };
}

function check(where: string, result: { text: Record<string, number>; shapes: Record<string, number> }) {
  if (process.env.CHAT_STAGE_REPORT) {
    console.log(`\n${where}`);
    for (const [label, ratio] of Object.entries({ ...result.text, ...result.shapes })) console.log(`  ${ratio.toFixed(2).padStart(6)}  ${label}`);
  }
  for (const [label, ratio] of Object.entries(result.text)) expect(ratio, `${where}: ${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  for (const [label, ratio] of Object.entries(result.shapes)) expect(ratio, `${where}: ${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
}

describe("stage mode follows the member's theme (#510)", () => {
  it("covers every theme and colour combination the chat offers", () => {
    expect(LOOKS.map((look) => look.id)).toEqual([...CHAT_THEME_VALUES, ...CHAT_PALETTES.map((palette) => palette.id)]);
    expect(LOOKS).toHaveLength(17);
  });

  it("maps the stage's colours onto the chat's theme tokens, never onto a colour of its own", () => {
    const mapped: Record<string, string> = {
      "--stage-page": "--chat-bg",
      "--stage-panel": "--chat-panel",
      "--stage-panel-2": "--chat-panel-raised",
      "--stage-card": "--chat-panel-raised",
      "--stage-control": "--chat-panel",
      "--stage-line": "--chat-line",
      "--stage-text": "--chat-text",
      "--stage-text-2": "--chat-muted",
      "--stage-label": "--chat-muted",
      "--stage-accent": "--chat-palm",
      "--stage-accent-fill": "--chat-palm-fill",
      "--stage-on-accent": "--chat-on-fill",
      "--stage-focus": "--chat-palm",
      "--stage-shadow": "--chat-shadow",
    };
    for (const [stage, chat] of Object.entries(mapped)) expect(stageTokens[stage], stage).toMatch(new RegExp(`^var\\(${chat}, [^)]+\\)\\)?$`));
    // The five made from two tokens.
    expect(stageTokens["--stage-positive"]).toMatch(/^color-mix\(in srgb, var\(--chat-success, [^)]+\) 75%, var\(--chat-text, [^)]+\)\)$/);
    expect(stageTokens["--stage-negative"]).toMatch(/^color-mix\(in srgb, var\(--chat-error, [^)]+\) 75%, var\(--chat-text, [^)]+\)\)$/);
    expect(stageTokens["--stage-control-line"]).toMatch(/^color-mix\(in srgb, var\(--chat-muted, [^)]+\) 45%, var\(--chat-line, [^)]+\)\)$/);
    expect(stageTokens["--stage-accent-soft"]).toMatch(/^color-mix\(in srgb, var\(--chat-palm, [^)]+\) 6%, var\(--chat-panel-raised, [^)]+\)\)$/);
    expect(stageTokens["--stage-accent-line"]).toMatch(/^color-mix\(in srgb, var\(--chat-palm, [^)]+\) 55%, var\(--chat-line, [^)]+\)\)$/);
    // The only fixed colours on the themed stage: LIVE's red and the white on it.
    const fixed = names(stageTokens, "--stage-").filter((name) => /^(#|rgb)/.test(stageTokens[name]));
    expect(fixed.sort()).toEqual(["--stage-live", "--stage-on-live"]);
    // The stage no longer repaints the room chat: it keeps the theme's own colours.
    expect(names(stageTokens, "--chat-")).toEqual(["--chat-grid"]);
    expect(names(phoneTokens, "--chat-")).toEqual(["--chat-grid"]);
    // The phone's themed parts.
    for (const [phone, chat] of Object.entries({ "--sp-panel": "--chat-panel", "--sp-panel-2": "--chat-panel-raised", "--sp-line": "--chat-line", "--sp-text": "--chat-text", "--sp-text-2": "--chat-muted", "--sp-focus": "--chat-palm" }))
      expect(phoneTokens[phone], phone).toMatch(new RegExp(`^var\\(${chat}, [^)]+\\)$`));
  });

  it("writes no colour of its own outside the token blocks", () => {
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(/i;
    const tokenBlocks = new Set([STAGE_SCOPE, ".player", ".root ~ section, .root ~ aside"]);
    for (const [file, css] of Object.entries({ stageCss, handsCss, phoneCss }))
      for (const block of blocks(css)) {
        if (tokenBlocks.has(block.selector)) continue;
        // Shadows and the placeholder's stripes are black or white at some strength, in every theme.
        const body = block.body.replace(/box-shadow:[^;]*;?/g, "").replace(/repeating-linear-gradient\([^;]*;?/g, "");
        expect(literal.test(body), `${file}: ${block.selector} { ${body.trim()} }`).toBe(false);
      }
    const card = tokensOf(cardsCss, ".liveVideo");
    expect(card.background).toBe("var(--chat-panel)");
    expect(card.color).toBe("var(--chat-text)");
    expect(tokensOf(cardsCss, ".liveVideoNote span").color).toBe("var(--chat-muted)");
  });

  it("on a phone held sideways, sets every colour token the room derives from the theme again", () => {
    // PublicChat's .page works out --ui-* from the theme's --chat-* tokens once, on the page. The
    // dark panel over the video sets the --chat-* tokens again, so it must set those again too.
    const derived = Object.entries(tokensOf(pageCss, ".page")).filter(([name, value]) => name.startsWith("--ui-") && /var\(--chat-(?!font)/.test(value));
    expect(derived.length).toBeGreaterThanOrEqual(11);
    for (const [name, value] of derived) expect(phoneLandscape[name], name).toBe(value);
    // And every colour the themes and combinations change is fixed there.
    const themed = new Set(LOOKS.flatMap((look) => Object.keys(look.tokens)).filter((name) => /^--chat-(?!font|dm-|term-edge|glow|grid|scrim)/.test(name) && LOOKS.some((look) => look.tokens[name] !== DARK[name])));
    for (const name of themed) expect(phoneLandscape[name], name).toBeDefined();
  });

  it("keeps the video's surround dark, and LIVE red, in every theme", () => {
    const c = (name: string) => colour(resolve(playerTokens[name], playerTokens));
    // Fixed: none of the player's or the phone's video colours reads a theme token.
    for (const name of names(playerTokens, "--stage-")) expect(playerTokens[name], name).not.toMatch(/var\(--chat-/);
    for (const name of names(phoneTokens, "--sp-").filter((item) => /^--sp-(page|video-|red|on-red|scrim)/.test(item))) expect(phoneTokens[name], name).not.toMatch(/var\(/);
    for (const name of ["--stage-video-black", "--stage-video-bar", "--stage-video"]) expect(luminance(c(name)), name).toBeLessThan(0.03);
    expect(luminance(colour(phoneTokens["--sp-page"]))).toBe(0);
    expect(luminance(over(colour(phoneTokens["--sp-scrim"]), WHITE))).toBeLessThan(0.05);
    // The player draws itself with these, whatever the page around it says.
    const player = tokensOf(stageCss, ".player");
    expect(player.background).toBe("var(--stage-video-black)");
    expect(tokensOf(stageCss, ".playerBar").background).toBe("var(--stage-video-bar)");
    expect(tokensOf(stageCss, ".playerControls").background).toBe("var(--stage-video-bar)");
    expect(tokensOf(phoneCss, ".screen").background).toBe("var(--sp-page)");
    // Red: much more red than green or blue.
    for (const live of [colour(stageTokens["--stage-live"]), c("--stage-live"), colour(phoneTokens["--sp-red"])]) {
      expect(live[0]).toBeGreaterThan(200);
      expect(live[0] - Math.max(live[1], live[2])).toBeGreaterThan(100);
    }
    expect(tokensOf(stageCss, ".liveBadge").background).toBe("var(--stage-live)");
    expect(tokensOf(stageCss, ".liveVideoBadge").background).toBe("var(--stage-live)");
    expect(tokensOf(phoneCss, ".liveBadge").background).toBe("var(--sp-red)");
  });

  it("the player's fixed dark colours are readable", () => check("player", measurePlayer()));

  for (const look of LOOKS) {
    it(`${look.id}: the computer stage is readable`, () => check(`${look.id} (computer)`, measureStage(look.tokens)));
    it(`${look.id}: the phone viewing room is readable`, () => check(`${look.id} (phone)`, measurePhone(look.tokens)));
    it(`${look.id}: the stage takes the look's own colours`, () => {
      const all = { ...look.tokens, ...stageTokens };
      const page = colour(resolve(all["--stage-page"], all)),
        text = colour(resolve(all["--stage-text"], all));
      expect(page).toEqual(colour(look.tokens["--chat-bg"]));
      expect(text).toEqual(colour(look.tokens["--chat-text"]));
      // A light look gives a light stage, a dark one a dark stage.
      expect(luminance(page) > 0.5).toBe(look.light);
      expect(luminance(text) < 0.2).toBe(look.light);
    });
  }
});
