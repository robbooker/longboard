# Membership badges verification

Ticket: 6de32928-182d-4445-ba2e-c413f78e2e3d

Room message, thread original/reply, and direct-message sender headers show compact green LB and pink SS pills, after the name and before Message/time. Labels have full product names in title and accessible text. Both memberships display LB then SS. Bots and messages without a verified member ID have no badges.

Server reads batch only author IDs from already-authorized result rows through the service-only `chat_member_memberships(uuid[])` function. LB requires a linked existing Longboard profile with a boardroom cohort-1/cohort-2 tag. SS requires a paid ShortScout provider identity verified within the existing 12-hour window. Room choice and admin role never supply membership. Failed lookups hide badges. No account IDs, provider subjects, or membership tiers are added to responses.

The additive `memberships` message field is populated on history/bootstrap, thread, direct-message reads, and send/edit acknowledgments. Realtime rows cannot supply badges; they invalidate the trusted history projection. Membership changes appear on the next existing reconciliation/read, rather than introducing per-message listeners. Pending messages have no inferred badge.

Validation:
- Unit suite: 689 tests across 92 files passed, including batch limits, deduplication, bots, rejected unknown labels, error fallback, and existing authorization tests.
- Isolated PGlite migration: LB/SS/both/neither, admin without tags, expired/free SS identities, all four paid tiers, membership removal, unknown member, and service-only grants passed.
- Actual shared badge + actual RoomMessageRow Chromium fixture: six membership combinations, ordering, labels, colors/shape, name/Message placement, DM click behavior, bot suppression, and no overflow at 320/390/1100 px passed. Ancillary row services are stubbed; the fixture does not authenticate or contact production.
- TypeScript, focused ESLint, and diff whitespace checks passed.

Limitations: this does not add badges to search-result lists, feature-ticket authors, pending local sends, or member-directory entries. Browser verification exercises the actual room row/shared badge; thread and DM insertion points are type-checked and reviewed. Existing membership freshness and periodic message refresh rules remain in effect. No production migration was applied.
