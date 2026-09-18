# Approvals on top

Approved request: `7bdb52fd-be58-4542-af8c-718f34e85941`.

The selected ticket now groups existing approval controls beside Archive, immediately below its title and status. Controls precede priority, discussion, composer, and the potentially long proposal. Narrow layouts wrap the groups naturally. Publishing controls include compact version, PR link, and commit context; the lower Publishing section retains status/detail information without a duplicate approval button. Sidebar task cards and Activity Trace markup are unchanged.

Eligibility and authorization are unchanged:

- Development Approve/Decline appears only for an owner viewing a discussion ticket outside proposal editing. Empty proposals still disable approval; busy actions disable controls. Development approval gains no extra confirmation.
- Publish/retry approval appears only for an owner viewing a ready ticket with a ready/failed release. Approved, publishing, published, missing-release, and other ineligible states have no approval button.
- Publishing retains the initial explicit button click followed by the existing native confirmation, including exact version, PR, and short commit text. The request still sends the captured full head SHA, release version, ticket revision, and `confirmed: true`. Cancel sends nothing. Server rejection remains visible and does not imply approval.
- Existing backend authorization, stale-version checks, release service, and Archive permissions are unchanged.

## Verification

`node scripts/tests/chat-approvals-top-browser.mjs` exercises the actual FeatureChannel in Chromium with isolated synthetic Alice/Bob authentication and intercepted feature responses. Tests cover owner/participant visibility, empty proposals, editing, busy state, development approval/decline, ready/retry eligibility, approved/publishing/other ineligible states, native confirmation cancel/accept, stale-response refusal, exact request payloads, keyboard activation, and long-discussion geometry in dark/light themes at 320/390/768/1440 pixels. No production approval or release dispatch occurs. Screenshots are `/tmp/approvals-top-{dark,light}-{width}.png`.

Integrated with origin/main `6aefefa7adeb96386e17d27f24acf19506554d16`: 529 unit/API tests across 73 files, TypeScript, targeted ESLint, the combined browser matrix, and production build all pass. The browser fixture includes an independent in-progress sidebar card and verifies its decorative Activity Trace remains outside the header action group without overflow at all four widths. The integrated screenshots were visually reviewed. Test servers are stopped. Existing unrelated build lint/Browserslist warnings remain. Browser verification uses desktop Chromium with mobile viewport emulation, not physical Safari/mobile devices.

The release plan `.release/7bdb52fd-be58-4542-af8c-718f34e85941.json` is migration-free. This change needs no database update, configuration, or production data mutation.

Release-state limitation at this verification: the coordinator reported PR305 live on the intended commit but its release-service bookkeeping unresolved after a duplicate Vercel deployment-ID race. This local validation does not reconcile that production record or authorize another release. No production state, release record, or queue claim was changed by this worker.
