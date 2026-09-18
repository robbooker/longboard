# SS chat membership policy

Implements request f831f3d7-7f51-48b5-b0b5-d3698597fef6 locally. SS and SS announcements require the exact verified ShortScout tier `mastermind`. Longboard admin status no longer bypasses this requirement. Monthly, annual and lifetime ShortScout identities retain SOCIAL and DMs. Ordinary ShortScout website login, memberships and account records are unchanged.

The authorization endpoint checks the server-stored requested room before issuing a handoff code. The consume RPC also rejects previously issued non-Mastermind SS codes. Every server chat authentication resolves the stored provider tier again; an existing linked identity or session does not imply SS access. SQL room authorization, announcement delivery and direct browser message/reaction reads enforce the same boundary. SS browser clients use authenticated polling; direct browser RLS does not provide a separate admin path.

## Verification

- 64 targeted Vitest cases across chatAccess, chatAuthResolution, chatLoginRoutes and shortscoutMembership passed.
- `node scripts/tests/chat-ss-mastermind-database.mjs`: 36 assertions using isolated PGlite, including preexisting paid sessions/codes, writes, downgrade, expiry, admin bypass removal, announcement recipients and direct authenticated-role reads.
- Targeted ESLint, TypeScript and production build checks recorded in the implementation handoff.
- Desktop 1440 and mobile 390 Chromium: an existing Mastermind cookie loads SS; changing its persisted tier to annual returns SS history 403 and SOCIAL 200; subsequent SS navigation exits the room. Existing unauthorized polling can navigate to sign-in while the server page redirects to the eligible room.
- ShortScout ChatConnect at both widths distinguishes email confirmation, membership denial, expired session and verifier unavailable; the isolated companion frontend also passes build, typecheck and nine error contract assertions.
- Screenshots: `/tmp/lb-ss-mastermind-{1440,390}.png`, `/tmp/lb-ss-annual-{1440,390}.png`, `/tmp/ss-membership-errors-{1440,390}.png`. Mobile coverage is Chromium emulation, not physical Safari.

## Remaining limits

Provider attestations keep the existing 12-hour verification lease. A cached non-Mastermind tier is rejected immediately on every request. An upstream downgrade of an identity still cached as Mastermind is not observable until re-verification or lease expiry; the chat does not store upstream access tokens. Already rendered messages cannot be erased from a user's memory or screenshots. Deidra's authoritative current membership remains unverified because the active ShortScout project is not available through the connected read access. No membership was granted or repaired.

## Release plan (approval required outside this implementation)

This is a coordinated Longboard migration/application plus ShortScout frontend change. No production operation was performed. Parent must pin the reviewed commits after integrating published main, obtain the exact-head approval, then apply `20260918141732_chat_ss_mastermind_access.sql` and deploy the matching Longboard application in one release window. Neither half alone provides all protections: older API code uses service access, while older SQL/RLS still has the admin path. Verify existing paid non-Mastermind, Mastermind and admin-only accounts across SS, SS announcements and SOCIAL after both operations. Deploy the companion ShortScout frontend for accurate handoff errors; its auth bridge remains unchanged because other paid tiers still need SOCIAL. Do not roll back to an application/migration pair that restores the bypass; fix forward or restrict SS access if validation fails.

Migration dependencies are the existing shared login, announcement rooms and boardroom access migrations. RPC signatures are preserved; no destructive data changes or member provisioning occur. The parallel notification feature continues calling the unchanged `chat_account_has_room(uuid,text)` signature.

Pinned SHA-256 digests:

- Migration: `9faf88121a08bc25f4a11fa3478c3945772733a3b576a5e06de57f5c61933508`
- `lib/shortscoutPolicy.ts`: `9037878fef581c3de7b1eb6fb946b1d5196379dfad192429d1c7fad60ba438b7`
- `lib/chatAuth.ts`: `840006165a65e1aa34c962a6d91934397af0c6112200dfbe6c4349f74c1859ed`
- Companion `src/pages/ChatConnect.tsx`: `f723f8021e053b2ed4d91b4231501d61ce60c8dc7b61b2bf827798f15c294503`
- Companion `src/lib/chatConnectionError.ts`: `04439b98d600f269b6e3bab41152e50dd8fa86bea2724bc1b5f1c46e648b1ebe`
