# S07 authenticated production chat browser measurements

Actual production Next servers, baseline 592b7f4 and S07 working tree, synthetic Alice admin session in the existing local PostgreSQL fixture. This is `/chat?room=main`, not the login page. Chrome/152.0.7977.82, 1440×900, device scale 1, 4× CPU throttle, cache disabled, fresh browser context each sample, 3 alternating samples per variant. No network throttling. Scripts recorded through a fixed 1-second window after the room composer appears, so hydration-triggered imports are included. No optional panels are opened.

| Median of 3 samples | Before | After |
|---|---:|---:|
| Loaded JS decoded KiB | 805.77 | 786.10 |
| Loaded JS encoded body KiB | 234.52 | 230.43 |
| JS transfer KiB (Resource Timing) | 238.33 | 233.95 |
| CDP ScriptDuration ms | 496.4 | 493.7 |
| CDP TaskDuration ms | 912.3 | 887.6 |
| Navigation-to-composer ms | 598.1 | 640.6 |

All four targeted deferred modules (ChatReplyPanel, ChatReportReview, ChatSearch, PedroChat) were absent from every after cold-chat sample, checked against exact loadable-manifest chunk filenames.

The script-execution medians are effectively unchanged at this sample size; navigation-to-composer was slower in the after median. These observations do not establish a user-visible speedup. The supported result is fewer initial bytes and confirmed deferred loading.

ScriptDuration is CDP's script-execution metric over this window; it is not a separately measured JavaScript parse time. TaskDuration includes other renderer work. Composer timing includes synthetic local server/database work and should not be interpreted as production-user latency. Three samples are descriptive evidence, not a statistical performance guarantee. Per-sample metrics and resource/chunk lists are in the adjacent JSON. Build hashes change filenames, so filename-set differences alone do not prove a particular module was removed; use the loadable manifest in the bundle report to identify deferred modules.

Before sample 1 loaded 13 JS files; after sample 1 loaded 12. No HTTP errors for recorded chunks or uncaught page errors.

Run: `node scripts/tests/chat-s07-network.mjs BEFORE_URL AFTER_URL OUTPUT_PREFIX`. Servers must use the synthetic fixture URL compiled into these builds.
