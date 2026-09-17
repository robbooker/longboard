# DM color scheme

Approved request: `6b1e71ce-384a-4dbf-9eae-615995edc41f`.

Sent messages use a dark bubble and received messages a pale bubble in every theme. Longboard uses green, Blade Runner uses violet, and ShortScout uses rose with a deeper magenta sent bubble in Blade Runner. Light mode preserves the same clear dark/light distinction. Existing left/right alignment, message formatting, requests, summaries, and sending remain unchanged.

Independent `--chat-dm-sent-*` and `--chat-dm-received-*` tokens define background, text, muted text, link, and border colors. Bubble-local mappings give shared body/link/chart-preview components the matching colors without changing the public-room palette or adding settings. Focus outlines also use the bubble's accessible link color. Later customization can override either set of tokens; paired text/background colors should retain contrast.

## Verification

The isolated synthetic fixture ran on 54424 and the local app on 3224. A temporary Chromium check exercised all five rooms (LB, Social, LB announcements, ShortScout, SS announcements), all three themes (dark, light, Blade Runner), and widths 1440/390: 30 combinations. It measured normal body text, author, timestamp, ordinary links, chart captions, and unavailable-preview labels against their actual bubble background. Both sent and received chart previews were checked. Body line breaks, actual UI sending, horizontal overflow, and page errors were checked as well.

Every measured text contrast exceeded 4.5:1 (minimum 5.59:1); minimum sent/received background contrast was 10.29:1. The browser log is `/tmp/chat-dm-colors-browser.log`. Screenshots follow `/tmp/chat-dm-colors-{main,shortscout}-{dark,light,blade-runner}-{1440,390}.png`; representative desktop/mobile images were visually inspected. The check is preserved outside the repository as `/tmp/chat-dm-colors-check.mjs` rather than adding a redundant permanent test.

No API, schema, migration, or access-control changes are required. This implementation does not add customization settings or separately implement the queued DM light-mode request.

TypeScript, targeted ESLint, `git diff --check`, and production build pass. The dev server was stopped before the build. Build output is `/tmp/chat-dm-colors-build.log`; it includes existing warnings in unrelated components. Both isolated servers were stopped after verification.
