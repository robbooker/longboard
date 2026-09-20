# S07: load secondary tools on demand

Search, report review and reply panel code use explicit dynamic imports. A cold room leaves search unmounted until first open, then keeps its instance hidden when closed to preserve the query/results. Report review retains its existing owner-only open gate and refetches on reopening. Replies retain the existing per-thread draft/navigation ownership, with a loading shell and back control while their chunk downloads.

The primary room feed and composer stay eager. DirectInbox owns sidebar and navigation coordination, so its shell remains eager. Notification/install/member-list triggers remain eager to avoid losing a first click, notification event, or visible member count.

Pedro uses a small route-aware loader: cold chat and other historically hidden paths do not download the assistant. Once visited on an eligible route, its existing instance is retained across navigation, preserving conversation state. Its own route/eligibility checks remain in place. OneSignal already excludes chat; this change does not change push permission, registration, or delivery.

No migrations or environment changes. Existing release approval and rollback process applies. Production chunk comparison and limitations are recorded in the accompanying S07 results report. Bundle-byte reductions are not end-to-end speed measurements.

Measured outcome: initial emitted gzip JS fell from 234.52 to 230.43 KiB (4.09 KiB, about1.7%). Authenticated cold browser traces agree on downloaded bytes. In three local samples per version, script execution was essentially unchanged (496.4 vs493.7ms median); navigation-to-composer was598.1 vs640.6ms. These timings do not demonstrate a startup-speed improvement. The verified benefit is smaller initial payload and loading optional tools only on demand; do not advertise an end-to-end speed percentage.

Browser acceptance passed against the actual production app with synthetic local data: cold search/reply/reports cause no panel reads; delayed first-use chunks show loading placeholders; search query/mode/results and reply draft/focus survive reopening; reports refetch; install and push-settings menu controls work on the first click. A separate actual-loader split-chunk fixture verifies no Pedro import on cold hidden routes and preserved draft through eligible→chat→eligible navigation. No real notification permission or subscription was requested.
