# DM light mode

Approved request: `60dc250f-d26f-4774-8648-41704e41de1e`.

Two light-theme overrides set `--chat-dm-received-bg` to white for Longboard and ShortScout. Sent bubbles, all text/link/border colors, and dark/Blade Runner themes retain their existing definitions. No message rendering, formatting, API, or database behavior changes.

Verification reused the prior isolated color matrix on ports 54424/3224 with synthetic conversations. All five rooms × three themes × desktop 1440/mobile 390 passed (30 cases). Computed sent backgrounds match the previously verified baseline in every case. Dark/Blade received backgrounds also match; light-mode received backgrounds are white and have higher luminance than the previous pale green/rose. Light-mode minimum text contrast is 6.54:1 and sent/received background contrast 12.07:1. Body/author/timestamp/link/chart-caption/fallback labels, both sent/received chart previews, line breaks, actual UI sending, overflow, and page errors were checked.

Evidence: `/tmp/chat-dm-light-browser.log`, temporary checker `/tmp/chat-dm-light-check.mjs`, and screenshots `/tmp/chat-dm-light-{main,shortscout}-{dark,light,blade-runner}-{1440,390}.png`. Representative Longboard mobile and ShortScout desktop light screenshots were visually inspected. TypeScript, targeted ESLint, and diff checks pass. Both isolated servers were stopped after verification.

Production build passes with existing unrelated lint warnings. The dev server was stopped before building; build output is `/tmp/chat-dm-light-build.log`.
