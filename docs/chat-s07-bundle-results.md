# S07 production chat bundle comparison

Baseline source: `592b7f4`, frozen snapshot. After: current S07 working tree. Both run the installed Next.js production build with the same dependency directory and synthetic public configuration. Build IDs: before `qP1P0vEFTQEw2nXGhpXOA`, after `aAVapXkVTenZxE-08IdBt`.

The initial set is the deduplicated JavaScript union of `/layout`, `/chat/layout`, `/chat/page` from Next's app-build-manifest. Sizes are actual emitted files; gzip uses Node's default gzip settings per file. This is a build-artifact measurement, not a claim about browser transferred bytes, parse time, execution time, or paint. Dynamic chunks may still load during hydration or on interaction; the browser trace is reported separately if available.

| Initial chat JS | Before | After | Change |
|---|---:|---:|---:|
| Uncompressed KiB | 806.55 | 786.88 | -19.67 |
| Per-file gzip KiB | 234.52 | 230.43 | -4.09 |
| Files | 13 | 12 | -1 |

## Before initial chunks

| File | KiB | gzip KiB |
|---|---:|---:|
| `static/chunks/webpack-5dcdb692472f91f2.js` | 3.63 | 1.87 |
| `static/chunks/c7a9eada-4ab2bb32af430e7f.js` | 168.97 | 53.09 |
| `static/chunks/6120-3bf40ae65f749896.js` | 168.94 | 45.10 |
| `static/chunks/main-app-0cd94a75b7d4b9fb.js` | 0.56 | 0.23 |
| `static/chunks/729-f8ccadec7bcf3b1a.js` | 7.86 | 2.81 |
| `static/chunks/app/layout-895c4d3453843302.js` | 17.71 | 5.09 |
| `static/chunks/app/chat/layout-5078a1303243f25c.js` | 0.98 | 0.52 |
| `static/chunks/7df096f5-75bf13eb13c7d0c4.js` | 51.80 | 11.64 |
| `static/chunks/8998-944f87d44b927928.js` | 8.36 | 3.32 |
| `static/chunks/2578-5cdc2ab339077c66.js` | 173.93 | 48.77 |
| `static/chunks/5787-74d5218ebeed3a3c.js` | 13.28 | 5.08 |
| `static/chunks/1596-3d411e5175d20262.js` | 16.56 | 5.72 |
| `static/chunks/app/chat/page-58d02b392bb41048.js` | 173.96 | 51.29 |

## After initial chunks

| File | KiB | gzip KiB |
|---|---:|---:|
| `static/chunks/webpack-a03b8178ec234798.js` | 5.01 | 2.43 |
| `static/chunks/c7a9eada-4ab2bb32af430e7f.js` | 168.97 | 53.09 |
| `static/chunks/6120-3bf40ae65f749896.js` | 168.94 | 45.10 |
| `static/chunks/main-app-0cd94a75b7d4b9fb.js` | 0.56 | 0.23 |
| `static/chunks/app/layout-da7d6f8221bdbce2.js` | 13.30 | 4.48 |
| `static/chunks/app/chat/layout-5078a1303243f25c.js` | 0.98 | 0.52 |
| `static/chunks/7df096f5-75bf13eb13c7d0c4.js` | 51.80 | 11.64 |
| `static/chunks/8998-944f87d44b927928.js` | 8.36 | 3.32 |
| `static/chunks/2578-5cdc2ab339077c66.js` | 173.93 | 48.77 |
| `static/chunks/5787-74d5218ebeed3a3c.js` | 13.28 | 5.08 |
| `static/chunks/1596-3d411e5175d20262.js` | 16.56 | 5.72 |
| `static/chunks/app/chat/page-92faa1010f69f93b.js` | 165.18 | 50.06 |

## Deferred module records

### Before

No matching loadable records.

### After

- `components/chat/PublicChat.tsx -> ./ChatReplyPanel`: `static/chunks/8051.848eb58b8029b94f.js` (3.37 KiB gzip)
- `components/chat/PublicChat.tsx -> ./ChatReportReview`: `static/chunks/9791.3b6ed6e0020d0a43.js` (0.89 KiB gzip)
- `components/chat/PublicChat.tsx -> ./ChatSearch`: `static/chunks/5585.7f6ce5accbe813f2.js` (2.02 KiB gzip)
- `components/pedro/PedroChatLoader.tsx -> ./PedroChat`: `static/chunks/1913.92e978d2fbc2f9b2.js` (4.32 KiB gzip)

Raw bytes, chunk mappings, and exact build paths are in the adjacent JSON report. Run: `node scripts/tests/chat-s07-bundle.mjs BEFORE_ROOT AFTER_ROOT OUTPUT_PREFIX`.
