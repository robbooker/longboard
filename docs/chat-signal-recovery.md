# Room connection warning recovery

The shared update transport aborts a batch that takes longer than 15 seconds. Previously, the native abort message reached PublicChat's general action-error state. A subsequent successful history read updated the messages but never cleared that error, leaving a stale warning after recovery.

Room history now owns separate connection feedback. A successful, current history reconciliation clears only that feedback; send, identity, opening-position and other action errors remain independent. Repeated failures leave one stable warning, a later genuine failure can show it again, and abandoned room watchers cannot update the next room. The warning also appears for read-only channels and on mobile.

The coordinator distinguishes intentional session disposal from its request deadline. Disposal is ignored by room recovery; timeouts remain retryable failures. An additional generation check after reading the response body prevents an old session response from settling current work. Polling cadence, authorization and retry scheduling are unchanged.

Diagnostics are fixed browser-console event names (`batch-timeout`, `history-unavailable`, `history-recovered`), with no identifiers, message content, paths, raw error text or credentials. History diagnostics occur only on transitions. This ticket is scoped to public room feedback; it does not redesign DM action/error presentation.

Validation:
- 811 unit tests across 102 files passed, including timeout/retry, intentional disposal and room recovery transition tests.
- TypeScript and focused ESLint passed.
- Production build passed (pre-existing unrelated lint warnings).
- `CHAT_FIXTURE_PORT=54545 CHAT_APP_PORT=3345 node scripts/tests/chat-recordings-fixture.mjs`
- Build/start with synthetic Supabase URL `http://127.0.0.1:54545`, anon key `test-anon-key`, service key `test-service-role`, site URL `http://localhost:3345`.
- `node scripts/tests/chat-signal-recovery-browser.mjs` passed against `next start`: native abort feedback, automatic recovery, recurrence, no repeated-warning replacement, preservation of a failed send, stale rejected room request after navigation, and mobile recovery/overflow.

No database changes or migrations.
