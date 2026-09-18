# Social community header

Ticket e6890217-d393-4073-8f55-cd3f6d4e3359 replaces the Social header's LB/palm badge artwork with a three-person community SVG. `SocialCommunityIcon.tsx` isolates the artwork for future replacement; the existing 42px badge supplies layout and theme colors. Its accessible image name is “Social community”. LB and SS artwork remains unchanged. No migration or behavior changes.

Validation: TypeScript, targeted ESLint and the production build passed (build log: `/tmp/social-header-build.log`; existing unrelated lint warnings only). Synthetic Chromium checks passed at 1440×900 and 390×900 in dark and light themes: icon present, correct theme, 42px badge, title separation and no horizontal page overflow. All four screenshots were visually inspected. Separate LB and entitled SS sessions retained their original identities. Evidence: `/tmp/social-header-browser.log` and `/tmp/social-header-{1440,390}-{dark,light}.png`. Mobile coverage is viewport emulation, not a physical device. The older synthetic fixture returns 503 for unrelated activity-read writes; this visual check does not validate notifications. No real messages were posted.

Release plan has no migrations and a public login smoke probe; authenticated visual acceptance is covered above.
