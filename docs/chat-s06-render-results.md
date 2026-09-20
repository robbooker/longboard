# S06 scoped room-row browser benchmark

Baseline: `5f30f42`. After: current working-tree production components. Chromium Chrome/152.0.7977.82, viewport 1440×900, device scale 1, CPU throttle 4×, React production bundle, 15 sequential parent updates per phase. Admin viewer; same generated plain-text/link/mention messages, no attachments, no scrolling or virtualization.

The baseline row JSX is extracted verbatim from PublicChat at the baseline commit. Dependencies (message body, actions, reactions, styles) come from that commit for baseline and current files for after. The after run uses actual RoomMessageRow. Parent state is a small harness, not the full chat app. Attachment rendering is replaced with an empty leaf; ChatUpdates returns null; fetch returns synthetic message/reaction responses; Next Image uses a native image. Actual body tokenization, MessageActions and MessageReactions run in both versions. Counters are injected only into temporary browser bundles. No production instrumentation.

| Version | Messages | Body renders: 15 typing | Body renders: 15 badge | Typing median / p95 ms | Badge median / p95 ms | Idle dialogs | DOM nodes |
|---|---:|---:|---:|---:|---:|---:|---:|
| before | 60 | 900 | 900 | 29.6 / 36.8 | 29.8 / 31.7 | 120 | 2412 |
| before | 500 | 7500 | 7500 | 246.5 / 272.0 | 238.7 / 255.9 | 1000 | 20012 |
| before | 2000 | 30000 | 30000 | 952.5 / 1408.7 | 948.0 / 989.1 | 4000 | 80012 |
| after | 60 | 0 | 0 | 0.1 / 2.1 | 0.1 / 0.6 | 0 | 1272 |
| after | 500 | 0 | 0 | 1.2 / 2.6 | 0.8 / 1.3 | 0 | 10512 |
| after | 2000 | 0 | 0 | 4.6 / 7.6 | 4.2 / 5.2 | 0 | 42012 |

Every scenario passed live reply-count text, edited body, edit-dialog Escape/focus return, reaction mutation/chip text and reaction-dialog focus return. One edited message rerenders 1 body after; a reply-count update rerenders zero bodies after. Baseline rerenders every body for either parent update. All body counts are asserted; timings are one-run observations, not production latency or full-app response-time claims. Timing covers synchronous React update/commit via flushSync and excludes paint, network and the rest of PublicChat.

Run: `node scripts/tests/chat-s06-render-browser.mjs`. Temporary bundles: `/tmp/chat-s06-render-IRLTjK`.
