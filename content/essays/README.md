# Essays

Long-form editorial content rendered at `/learn/[slug]`. Each essay is a single
`.mdx` file in this directory. To add an essay, drop a new file here and
rebuild — the `/learn` index and the `[slug]` route pick it up via
`generateStaticParams` reading this directory.

## File naming

```
{issue-padded-3}-{slug}.mdx
```

Examples:

```
001-the-basic-trade-is-against-yourself.mdx
002-never-let-a-small-loss-become-a-huge-one.mdx
```

The padded issue prefix sorts files on disk in publication order. The slug
after the dash matches the URL: `/learn/the-basic-trade-is-against-yourself`.

## Frontmatter contract

Every essay starts with a YAML frontmatter block. All fields below are
required unless marked optional.

```yaml
---
issue: 1
slug: the-basic-trade-is-against-yourself
title: "The basic trade is against yourself."
title_accent: "against yourself."
kicker: "An essay on process & restraint"
dek: "A long-form post about greed, process, and the quietly destructive habit of asking a good trade to become a perfect one."
filed_under: "Process"
issue_label: "Trading Psychology"
read_minutes: 14
published: 2026-04-15
marginalia:
  - label: "Premise"
    body: "The market is the obvious adversary..."
  - label: "On size"
    body: "Emotional neutrality, the essay argues..."
sources:
  - "Nobel Prize press release..."
  - "Terrance Odean, *Are Investors Reluctant...*"
audio_url: "https://audio.longboard.ai/001.m4a"  # optional
---
```

### Field reference

| field | type | notes |
| --- | --- | --- |
| `issue` | integer | Issue number. Drives sort order on the index (desc). |
| `slug` | string | URL segment. Must match the filename's slug portion and be unique. |
| `title` | string | Full headline. |
| `title_accent` | string | The tail of `title` to render in italic moss. Must appear verbatim at the end of `title`. |
| `kicker` | string | Small eyebrow line above the headline. |
| `dek` | string | One-sentence summary under the headline; also shown on the index card. |
| `filed_under` | string | Section label (e.g. "Process", "Risk"). |
| `issue_label` | string | Second-line classification (e.g. "Trading Psychology"). |
| `read_minutes` | integer | Hand-estimated reading time. |
| `published` | date | YYYY-MM-DD. Used in footer and index card. |
| `marginalia` | array of `{label, body}` | Optional. Sticky margin notes on desktop. Omit or pass `[]` for no marginalia. |
| `sources` | array of strings | Optional. Numbered sources block at essay end. Omit or pass `[]` for no sources. |
| `audio_url` | string | Optional. Permanent R2 URL to the M4A recording of this essay. When present, an inline audio player renders below the byline. Omit to suppress the player entirely. |

## Body

The body is MDX. Standard markdown plus these custom components (auto-imported
via `components/essays/mdx-components.tsx`):

- `<Pullquote>…</Pullquote>` — breaks into right margin on desktop.
- `<MaximStack>` with `<Maxim>` children — numbered maxim list.
- `<Break />` — section dinkus / divider.

`h2` elements (`## Heading`) auto-number as `§ I`, `§ II`, `§ III` with
italic Fraunces. The first `<p>` in the article gets a drop cap.

Example body:

```mdx
There are, broadly speaking, two ways to lose money trading.

The first is the glamorous way...

<Pullquote>
If a trade is large enough to make you euphoric on the way up
or panicked on the way down, it is too large.
</Pullquote>

## What the research says

Economists and psychologists have spent decades...

<MaximStack>
  <Maxim>**Trade smaller** than you want to.</Maxim>
  <Maxim>Take the setup you can **actually repeat**.</Maxim>
</MaximStack>
```
