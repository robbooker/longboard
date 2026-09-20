# S06: reduce room-feed rendering work

Room messages now have a memoized row boundary. Composer typing and unrelated shell state changes retain row props; body tokenization has its own memo boundary so reply counts and permission changes do not retokenize unchanged text. Every permission and interaction input remains an explicit prop, with default React shallow comparison (no custom comparator hiding changes).

History reconciliation reuses equal message objects, retaining authoritative server order/deletions and pending local sends. It compares all supplied fields, including ordered attachment IDs. It does not introduce a new cache or change authentication.

Room action and room/DM reaction dialogs mount only when opened. Close, Escape, successful submission, and loss of permission remove the dialog. Focus returns to its trigger. Busy submissions retain existing safeguards and errors remain visible.

The current reaction provider already batches visible targets and indexes by message identity; S06 does not duplicate that work. No virtualization or CSS layout redesign was added. The room feed currently caps ordinary realtime history, so 500/2,000-row fixtures are stress tests rather than typical production history sizes.

Validation: 665 unit tests, TypeScript, focused ESLint, release-service regression checks, and actual-component modal lifecycle browser tests. Performance fixture results are recorded separately. These are local synthetic measurements, not physical-phone or production p95 claims.

Release: no migrations or environment changes. Rollback is a code revert through the normal approved release flow. Feature request: 6c897cb8-278b-4d11-b660-ced853808cd1.
