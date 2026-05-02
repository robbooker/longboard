# Longboard Editorial Design System

**Version:** 1.0 (May 1, 2026)
**Maintained at:** `docs/design-system.md` in `github.com/robbooker/longboard`
**Mirrored to:** Longboard project knowledge in Claude

---

## What this document is

A locked specification of the Longboard editorial visual language. It exists so that every member-facing surface — emails, the Command Center, essays, the Boardroom, future pages, future Claude Design conversations — converges on one look instead of diverging into five almost-but-not-quite-the-same looks.

This document was extracted from three live, working artifacts:

1. The morning email (`/admin/morning-email` → `morning_email_archive` rendered HTML)
2. The Command Center v2 page (`/command2`)
3. The Longboard essay pages (`/learn/*`)

All three were designed independently from each other but ended up in the same neighborhood. This spec writes down the rules they share so future work starts from the spec instead of from a screenshot.

---

## What this document is not

- It is **not** a CSS migration plan. The current `app/globals.css` light/dark theme variables stay where they are. This spec sits on top as design DNA, not a replacement.
- It is **not** a component library. We're not specifying button shapes, form widgets, or a Storybook. Those can come later.
- It does **not** apply to the trading dashboards (`/alpaca`, `/tradezero`). Those have their own terminal aesthetic for tactical reasons (live-trading surfaces benefit from the green-on-black IBM Plex Mono treatment) and should not be brought into this system. Same applies to `/research/*` and `/surf` — those are tools, not editorial.
- It is **not** a brand guidelines document for logos, social media, or print. Just the digital editorial surfaces.

---

## What this document covers

Everything member-facing, public-marketing-facing, or editorial:

- The morning email and any future email
- `/` (the bubbles landing page is an exception — see "Outliers" at the bottom)
- `/learn/*` (essay pages)
- `/command2` (and future Command Center)
- `/login`, `/login/forgot`, `/onboarding` (target state — currently uses hardcoded hex)
- `/thanks`
- Future surfaces: `/pricing`, `/about`, Boardroom landing, Pedro UI when it ships, anything new

---

## 1. Palette

Four named colors. Every other color in the system is one of these four with adjusted opacity.

### The four colors

| Name | Hex | Role |
|---|---|---|
| **Cream** | `#F6F2E9` | Primary surface (page background) |
| **Ink** | `#15120B` | Text on cream; also the surface for "dark cards" inside cream layouts |
| **Amber** | `#F5A524` | Primary accent. CTAs. Hero numbers. The single bright pop on the page. |
| **Gold** | `#B8860B` | Quiet accent. Eyebrow text. Inline metadata. Small italic flourishes (the "AI" in "LongboardAI"). |

### Surface variants (cream family)

Cream is rarely used at exactly `#F6F2E9` for cards. Inset surfaces lift slightly:

| Name | Hex | Role |
|---|---|---|
| `--cream` | `#F6F2E9` | Page background |
| `--card` | `#FBF8F0` | Card on cream (e.g. the Command Center hero card, ranked rows) — about 1 step lighter than cream |
| `--card-2` | `#EFEADD` | Inset chip / metadata block on a card (Float card, Volume card on hero pick) — about 1 step darker than cream |

### Ink with opacity

Used for text and borders. Always rgba over the literal ink color for readability layering:

| Token | Value | Role |
|---|---|---|
| `--ink` | `#15120B` | Body text, dark cards, hero numbers (when not amber) |
| `--ink-70` | `rgba(21,18,11,0.72)` | Secondary text (italics, deks, "what traders are saying" prose) |
| `--ink-55` | `rgba(21,18,11,0.55)` | Tertiary text (column metadata, "small" notes inside numbers) |
| `--ink-30` | `rgba(21,18,11,0.16)` | Card borders, divider lines |

### Paper (cream-on-ink) variants

When ink is the surface (dark cards, top nav, footer), text is cream-toned:

| Token | Value | Role |
|---|---|---|
| `--paper` | `rgba(244,241,232,0.85)` | Default text on ink |
| `--paper-55` | `rgba(244,241,232,0.55)` | Secondary text on ink |
| `--paper-18` | `rgba(244,241,232,0.18)` | Borders / dividers on ink surfaces |

### Up / Down (sparingly)

When semantic color is needed (charts, P&L, the rare red flag):

| Token | Value | Role |
|---|---|---|
| `--up` | `oklch(0.58 0.13 148)` | Green — sparingly. We mostly use amber for "up" signal. |
| `--down` | `oklch(0.55 0.18 28)` | Red — sparingly. Reserved for actual loss / serious risk. |

**Crucial rule about color and direction:** Longboard does not use red/green for change percentages on the editorial surfaces. A `+114.9%` is rendered in **gold** (`--gold`), not green. This is a deliberate departure from terminal convention. Reason: editorial framing — these aren't quotes flickering on a screen, they're picks in a publication. Red/green creates the wrong cognitive frame ("watch the tape!"). Amber/gold creates the right one ("this is a curated story").

The trading dashboards (`/alpaca`, `/tradezero`) DO use red/green for P&L. That's correct for those surfaces and outside the scope of this system.

### Forbidden combinations

- ❌ Amber on cream for body text (low contrast, hurts readability) — amber is for *big things* (hero numbers, headlines, CTAs, single emphasized words). Use gold for inline accent text on cream.
- ❌ Gold on ink (dark surface) for body text — invisible. Use amber for accent text on dark surfaces.
- ❌ Green or red anywhere on editorial surfaces unless representing actual semantic up/down direction. No green CTAs. No red dividers.
- ❌ Any color outside this palette. Pure black (`#000`) appears once intentionally as the top-nav bottom border but is otherwise replaced by ink. Pure white never appears.

---

## 2. Typography

A three-font stack. Each font has a specific job. Mixing them within a single block is a feature, not a bug — the "Helvetica head with one Georgia italic phrase tucked inside" pattern is the Longboard signature.

### The three fonts

| Font | Stack | Role |
|---|---|---|
| **Helvetica** | `Helvetica, Arial, sans-serif` | All numbers. All headlines. Default body (when not editorial prose). |
| **Georgia italic** | `Georgia, 'Times New Roman', serif` | Editorial prose. Pull quotes. Deks. The italic phrase nested inside a Helvetica head. Body of bullet lists in essays / catalysts. |
| **Courier New mono** | `'Courier New', Courier, monospace` | Eyebrows, labels, metadata, all-caps tags. Anything that's "operating system chrome" rather than content. |

No other fonts. No IBM Plex (that's the dashboards). No serif other than Georgia. No sans other than Helvetica.

### The signature move: italic-inside-sans-head

The single most recognizable Longboard typographic pattern. Used in essays, the morning email H1, and the Command Center H1.

Pattern: a multi-line Helvetica heavy headline with **one phrase rendered in Georgia italic** breaking the rhythm. Example from the morning email and Command Center:

> **Five names**
> *on the radar*
> **this morning.**

The italic phrase is always:
- Georgia italic, font-weight 500 (not 800 like the surrounding head)
- The same font-size as the surrounding Helvetica
- Letter-spacing slightly tighter than the Helvetica around it (`-1.6px` vs `-2.4px` typical)
- Inline, not a separate line, even when the line breaks visually

CSS shorthand:

```css
.h1 { font-family: Helvetica; font-weight: 800; letter-spacing: -2.4px; }
.h1 .ed { font-family: Georgia; font-style: italic; font-weight: 500; letter-spacing: -1.6px; }
```

```html
<h1 class="h1">
  Five names<br/>
  <span class="ed">on the radar</span><br/>
  this morning.
</h1>
```

When to reach for it: when the headline has a "set-up + emotional beat + payoff" three-part rhythm. Not every head needs it — single-clause heads stay in pure Helvetica.

### Headline scale

Approximate ranges, not strict tokens:

| Level | Size (desktop) | Size (mobile) | Weight | Letter-spacing |
|---|---|---|---|---|
| Hero H1 | 60–64px | 44px | 800 | `-2.4px` to `-2.6px` |
| Section H2 | 32–36px | 26px | 800 | `-1.0px` to `-1.2px` |
| Card / row title | 18–22px | 16–18px | 700–800 | `-0.3px` to `-0.6px` |
| Hero number (e.g. `+114.9%`) | 44–60px | 28–32px | 800 | `-1.6px` to `-1.8px` |
| Pick number (the giant `01`) | 140px | 88px | 800 | `-7px` |

Hero numbers and pick numbers are typographic features. They are intentionally too large. Don't shrink them to "tame" the page — that's the look.

### Body text scale

| Use | Font | Size | Line-height |
|---|---|---|---|
| Editorial prose (Georgia) | Georgia italic or roman | 17–18px | 1.5–1.6 |
| Card body / catalyst bullets | Georgia italic | 15–17px | 1.5 |
| Sentiment / "what traders are saying" | Georgia italic | 17px | 1.6 |
| Helvetica body (when needed) | Helvetica | 15–16px | 1.5 |

### The mono/eyebrow style

The single most repeated pattern in the system. Every section, card, and meta block on every editorial surface starts with a Courier mono eyebrow line.

Pattern:

```html
<div class="mono">● MORNING BRIEF — FIVE NAMES ON THE RADAR</div>
```

```css
.mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 10–12px;            /* context-dependent */
  letter-spacing: 1.4–1.8px;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--gold);            /* on cream */
        /* or var(--amber) on ink */
}
```

Specifics:
- **Always uppercase.** Always.
- Letter-spacing is non-negotiable — without it the mono looks broken.
- Color is **gold on cream surfaces** and **amber on ink surfaces** (yes, they swap — amber is brighter for the dark contrast, gold is more elegant for the light).
- Lead with one of two characters: `●` (filled bullet, for section headers / "you are here" markers) or `→` (right arrow, for sub-sections / "next thing" pointers). Use sparingly — not every mono line gets a lead character.
- Risk-flag rows use `▲` instead.

### When to use which font

A decision tree:

- **Is it a number or a headline?** → Helvetica.
- **Is it metadata, an eyebrow, a tag, a small "STATUS"-style label?** → Courier mono, all caps.
- **Is it editorial prose, a pull quote, a dek, or a humanizing italic phrase inside a head?** → Georgia italic.
- **Is it none of the above (e.g. a paragraph of body text)?** → Helvetica or Georgia depending on whether the page is "operational" (Helvetica) or "editorial" (Georgia). The morning brief uses Georgia for body. The Command Center uses Helvetica for body. Both are correct in their context.

---

## 3. Recurring patterns

These are visual idioms that appear multiple times across the system. Naming them so future work uses the same pattern instead of inventing a new one.

### 3.1 Risk flag row

Used wherever a stock has risk flags listed. Email and Command Center both use it identically.

Pattern: leading triangle, gold/amber color, mono uppercase, separated by ` · `.

```
▲ RISK FLAGS · DILUTION · PIPE OVERHANG · REVERSE SPLIT · LOW FLOAT · CASH BURN · WARRANT OVERHANG
```

```css
.risks {
  font-family: 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 1.4px;
  color: var(--gold);
  font-weight: 700;
  line-height: 1.6;
}
```

The triangle `▲` is intentional — it reads as "warning" without being a literal warning sign, and pairs well typographically with the Courier mono.

### 3.2 Big-number-with-label

The hero stat treatment. Used for AVG MOVE, TOP RUNNER, TOTAL VOL, hero pick price/change, target prices, etc.

Pattern: small mono uppercase label on top, big Helvetica number underneath, optional Georgia italic context line below.

```html
<div>
  <div class="mono">AVG MOVE</div>
  <div class="big-num">+60.5<span class="amb">%</span></div>
  <div class="ed-small">across the board</div>
</div>
```

The percent sign is rendered smaller than the number and in amber, even when the number itself is ink. This pattern is repeated everywhere percentages appear.

### 3.3 Card with eyebrow + headline

The Command Center hero card. The Morning Market Pulse block. Future cards on future pages.

Three-part stack:
1. Mono eyebrow line (gold on cream / amber on ink) — `● SECTION NAME`
2. Helvetica heavy headline, often with an italic Georgia phrase inside
3. Card body (Georgia italic on cream cards, Georgia italic on ink cards too — Georgia goes everywhere body lives)

### 3.4 The "where it goes / where it doesn't" subtitle

Pattern from price-target sections:

> **Where it goes.** *Where it doesn't.*

Helvetica heavy first phrase, Georgia italic second phrase, on the same line. The amber accent is on the italic phrase. This is the Longboard editorial voice as visual rhythm — declarative + qualifying, in two beats.

### 3.5 The dark callout inside the cream layout

Used for: Morning Market Pulse, Price Targets, top nav, footer. Anywhere the editorial flow needs to *interrupt itself* with a different register.

The dark callout is a full-width ink-colored block (`background: var(--ink); color: var(--paper)`) with all the same internal patterns (mono eyebrow, Helvetica heads, Georgia italic body) but in the inverted color treatment. Mono color flips from gold to amber. Ink-tone variables flip to paper-tone variables.

Use sparingly — typically 1–2 per page. The dark callout is dramatic. If everything is dramatic, nothing is.

### 3.6 The amber callout block

A solid amber block with ink text on it. The Command Center "AT THE OPEN +114.9%" hero strip is the canonical example.

```css
background: var(--amber);
color: var(--ink);
```

Used to single out *one* number as the most important thing on the page. There should be at most one amber callout block per editorial surface. More than one and amber loses its meaning.

### 3.7 The bordered metadata strip

Thin ink-30 borders top and bottom, mono uppercase content between them, rendered at the bottom of cards or sections.

```
$31.68 · +114.9% · VOL 5.2M · MCAP $41M
```

```css
border-top: 1px solid var(--ink-30);
border-bottom: 1px solid var(--ink-30);
font-family: 'Courier New', monospace;
font-size: 11–12px;
letter-spacing: 1.2px;
color: var(--ink-70);
font-weight: 700;
```

Strong values in `var(--ink)` weight 800 (the price), accent values in `var(--gold)` (the change %). Separator is always ` · ` (with spaces).

### 3.8 The pick number

The giant `01`, `02`, `03` etc. that ranks each stock. Pure typographic spectacle.

```css
font-size: 140px;          /* hero pick */
font-size: 72px;           /* rank 02-05 */
font-weight: 800;
color: var(--amber);       /* rank 1 */
color: var(--gold);        /* rank 2-5 */
letter-spacing: -7px;      /* hero */
letter-spacing: -3.6px;    /* rank 02-05 */
line-height: 0.85;
```

The negative letter-spacing is what makes it read as "design" rather than "data." Don't loosen it.

### 3.9 The italic-Georgia date / sign-off

End of the morning email:

> *Rob, Pedro, and Buddy*
> — the Longboard Editorial Team

First line Georgia italic. Second line Courier mono uppercase, ink-55 color. This is the editorial signature. Use it (or an adapted version) wherever a member-facing surface ends with a "from us" moment.

---

## 4. Spacing rhythm

Not strict tokens, but a defensible rhythm.

| Use | Value |
|---|---|
| Section gap (between major page sections) | 48–56px desktop, 32–36px mobile |
| Card internal padding | 24–28px |
| Mono eyebrow → headline | 14–18px |
| Headline → body | 18–24px |
| Body paragraph spacing | 14–16px |
| Bullet list item spacing | 6–8px |

The numbers are generous on purpose. Editorial breathes. If a layout feels too cramped, the answer is almost always more vertical space, not smaller text.

### Page-level horizontal padding

Use a single CSS custom property per page (e.g. `--cc2-hpad`, `--bub-hpad`, `--ty-hpad`) to control horizontal gutters. 28px desktop, 16px mobile. Apply consistently to every section's padding. This is the convention from the landing-page playbook and continues to apply.

---

## 5. Mobile breakpoint

Single breakpoint at **768px**. Below it, everything that was multi-column collapses to single column. Specific mobile rules:

- Hero numbers downscale (e.g. `140px` → `88px`)
- Pulse strip (3-up grid) → vertical stack
- Hero top (3 columns: pick number, ticker block, price block) → stacked
- Ticker strip → horizontal scroll (`overflow-x: auto`) instead of clipping
- Top nav → collapse search field, plan tag, secondary links; keep brand + critical right-side actions
- Page horizontal padding → 16px

The mockups already encode these. New surfaces should follow the same patterns.

---

## 6. The unified light/dark question

Currently, the editorial surfaces (essays, Command Center v2, morning email) are **always cream-and-ink, regardless of the user's light/dark setting at `/settings`**. The dashboards (`/alpaca`, `/tradezero`) honor light/dark. The research/terminal pages have their own palette.

**Decision (locked):** Editorial surfaces are *always* cream-and-ink. They do not respect the user's light/dark preference. Reasons:

1. Editorial framing is the brand. A "dark-mode morning email" makes no sense — the cream paper is part of the voice.
2. The palette is precisely tuned. Inverting it loses the gold/amber distinction (gold reads identical to amber on a dark background).
3. The dashboards keep their own theme system. The split is sensible: editorial = published artifact (light-only), dashboards = tools (theme-aware).

If a future user complaint suggests this is wrong, revisit. For now, locked.

---

## 7. Outliers (intentional exceptions)

Surfaces that are *deliberately* outside this system, with reasons:

- **`/alpaca` and `/tradezero`** — terminal aesthetic, green-on-black, IBM Plex Mono. Tactical, not editorial. Out of scope.
- **`/research/*` and `/surf`** — terminal aesthetic, same family as the dashboards. Out of scope.
- **The `/` bubbles landing page** — this is currently a separate aesthetic (illustrated, conversational, different typographic mood) chosen specifically because the homepage funnels cold traffic and has different conversion goals than a member-facing editorial surface. It's the "outside voice" of the site. The Boardroom area, member-facing pages, and pricing/about pages should use *this* design system. The landing page does not. (If at some future point we redesign `/` to match the editorial system, that's a separate project — until then, it's an intentional outlier.)
- **The `/thanks` page** — currently a separate aesthetic matching the bubbles landing. Same reasoning. May or may not migrate.

Everything else uses this system.

---

## 8. Reference implementations

Working code that exemplifies the system. Read these files when you want to copy a pattern.

| Pattern | File / URL |
|---|---|
| Full editorial layout, all patterns in one place | `components/command2/CommandCenterV2.tsx` |
| Email rendering of the same data | `morning_email_archive.html` (latest row), or rendered at `/admin/morning-email` |
| Long-form essay treatment | `/learn/{any-essay-slug}` and `app/learn/essay-styles.css` |
| The CSS variables (canonical hex values) | `:root` block in `CommandCenterV2.tsx` |

---

## 9. How to use this document

**For a new page or surface:**
1. Read this doc.
2. Pick the patterns that apply (almost always: mono eyebrow + Helvetica head + Georgia body + cream surface + at most one amber callout).
3. Reuse the exact CSS variables and font stacks. Don't rename them. Don't adjust the hex values "slightly."
4. Cross-reference one of the reference implementations.
5. If you need a pattern that isn't in this doc, propose it as a v1.1 addition rather than improvising silently.

**For a Claude Design conversation:**
1. Paste this whole document as the first message of the chat (or attach it as a project file).
2. Provide the existing reference image (Command Center, morning email) so the model can see the rules applied.
3. Ask for the new surface in the system. The model should produce something that drops in cleanly.

**For a Claude Code conversation:**
1. The doc lives at `docs/design-system.md` in the repo. CC reads it when prompted.
2. When asking CC to build a new editorial page, include "follow `docs/design-system.md`" in the prompt — same way you reference the landing-page playbook.

---

## 10. What's not yet locked (v1.1 candidates)

Things this doc deliberately does not specify yet, because the working artifacts haven't pushed on them enough:

- **Forms.** The login page redesign (in progress) will produce the first canonical form treatment. When it ships, capture the patterns here.
- **Buttons.** The morning email and Command Center don't have many. The Boardroom and pricing pages will. Capture when they ship.
- **Tables.** Beyond the ranked-rows pattern in the Command Center, no canonical table treatment yet.
- **Charts and sparklines.** The Command Center has one inline SVG sparkline pattern. If charts proliferate, formalize.
- **Tooltips, modals, toasts.** None of the current artifacts use them. Will need a treatment when needed.
- **Loading states.** No canonical skeleton-loader pattern yet.
- **Empty states.** No canonical empty-state treatment.
- **Dark editorial.** Currently locked as "no dark mode for editorial." If that changes, the whole palette needs a paired dark variant.

---

## 11. Versioning

This doc is versioned. When patterns change or get added:

- **Patch (1.0 → 1.1):** new pattern added, no breaking changes to existing surfaces.
- **Minor (1.0 → 1.1 → 1.2):** new outlier added, scope adjusted.
- **Major (1.x → 2.0):** palette changes, font changes, anything that requires every existing editorial surface to be updated.

Date and version stamp at the top. Note breaking changes prominently.

---

*— Compiled May 1, 2026, from the Command Center v2 mockup, the morning email template, and the Longboard essay system.*
