# floor — live trading notes

Short-form notes that render in the "From the floor" black band on
the Daily homepage at `/learn`. Rob drops a `.mdx` file in this
directory with an ISO timestamp + optional ticker, and the band
picks it up at build.

Per Phase 3L's audit decision 4, this is the MDX-collection path —
lowest effort, editorial control via git, no admin UI.

## Filename convention

Any filename ending in `.mdx`. The sort key is the `timestamp`
frontmatter field, not the filename, so naming is purely for the
author's convenience. Suggested pattern:

```
2026-04-15-0934-MARA.mdx
YYYY-MM-DD-HHMM-TICKER.mdx
```

Keeps files sorted on disk by time.

## Frontmatter contract

```yaml
---
timestamp: 2026-04-15T09:34:00-04:00
ticker: MARA
author: Rob Booker
---

**MARA** halted at 22.40, LUDP. This is the one. If it reclaims
the 5-min VWAP into the reopen I want to short small. *Small.*
```

| field | type | notes |
| --- | --- | --- |
| `timestamp` | ISO datetime | Required. Drives both the displayed HH:MM ET and the sort order (desc). Include the timezone offset so the same file reads correctly from any build environment. |
| `ticker` | string | Optional. Used to distinguish notes visually; the reader itself doesn't enforce uniqueness or format. |
| `author` | string | Required. Currently always "Rob Booker" — kept as a field so future guest notes don't need a schema change. |

## Body

The body is short-form prose. Markdown emphasis markers work:

- `**TEXT**` → `<strong>TEXT</strong>` (moss-highlighted; use for tickers)
- `*text*` → `<em>text</em>` (inline italic emphasis)

No other markdown or JSX. The reader deliberately supports only
these two transforms — floor notes are one-line observations, not
essays. If you need paragraphs, put it in `content/essays/`.

## Display behavior

- Band shows the 4 most recent notes on `/learn`.
- Band hides entirely when the directory is empty — no "coming
  soon" placeholder.
- The band's "last updated" meta line is computed from the newest
  note's `timestamp`.
