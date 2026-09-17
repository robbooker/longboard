# Bold reply counts

Approved request: `1d24d10c-4574-4ee6-aa1e-72555ee97f14`.

Existing numeric reply labels in the shared room-feed renderer are now 13px and weight 700 when their count is positive. Zero replies keep the existing “Reply” action at 12px and normal weight. This applies across rooms and responsive layouts without changing labels, count loading, click behavior, or access controls. Generic parent/nested-conversation actions remain normal; no new nested count fetching is introduced.

Verification used the isolated PGlite fixture on port 54424 and localhost app on port 3224 with synthetic accounts. At 1440px and 390px, real messages with 0, 1, and 3 direct replies rendered at 12px/400, 13px/700, and 13px/700 respectively. All three actions opened the correct thread contents at both widths. Generic nested actions retained normal styling. No page errors or horizontal overflow occurred. Screenshots were visually inspected at `/tmp/chat-bold-reply-1440.png` and `/tmp/chat-bold-reply-390.png`; results are in `/tmp/chat-bold-reply-browser.log`.

TypeScript, targeted ESLint, diff checks, and the production build pass. The dev server was stopped before building; output is saved at `/tmp/chat-bold-reply-build.log`. The temporary browser check was retained as `/tmp/chat-bold-reply-check.mjs`, without adding an implementation-mirroring test to the repository. No API or database changes are needed.
