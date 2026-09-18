# Feature request card layout

Request 998c5ab7-510a-4f96-93df-0f9314b94e25. The Feature Requests navigation cards now use three explicit rows for title, priority badge and workflow status, with uniform 14px padding and 8px spacing. Priority badges align with titles instead of running inline against them. Status dots occupy their own column, so wrapped labels keep a consistent text edge. Flexible title rows balance neighboring cards in the tablet grid; status rows reserve two lines without truncating longer content.

This is scoped to FeatureChannel card CSS. Status wording, colors, glows, selected/focus styles, reduced-motion behavior, theme controls and ticket actions are unchanged. No API, migration or other chat component changes.

Validation: all 458 unit tests across 67 files passed; TypeScript and targeted ESLint passed. Real Chromium browser checks cover ten workflow states, emergency/ordinary priority badges, long and unbroken titles, the publishing-awaiting-pickup status, 320/390/768/1280 widths, light/dark themes, selected ticket navigation and reduced-motion. The test asserts equal padding, title/badge/status left edges, separated rows, bounded content and no page overflow; it allows the existing one-pixel decorative glow inset. Mobile coverage is emulation, not physical Safari.

Browser script: `scripts/tests/chat-feature-card-layout-browser.mjs`, port 3270 against an isolated synthetic fixture at 54470. Feature API responses are intercepted with synthetic cards. Screenshots: `/tmp/feature-card-dark.png`, `/tmp/feature-card-light.png`, `/tmp/feature-card-320.png`, `/tmp/feature-card-390.png`, `/tmp/feature-card-768.png`, `/tmp/feature-card-1280.png`. Tablet and narrow mobile screenshots were visually inspected. Production build status is recorded in the final handoff.

The migration-free release plan is `.release/998c5ab7-510a-4f96-93df-0f9314b94e25.json`. Its login probe is only an unauthenticated smoke check; browser checks establish card behavior. No production operation or publication was performed.
