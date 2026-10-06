# Start chat at the oldest unread message

Approved request `a3c69c63-7a91-4ff8-9868-4b8a6d2ffbb1`, revision 2. Based on published main `2c92b3a8fd1ec67c92efe25d1fff63ca5f9c0679`, including mobile keyboard dismissal. This intentionally supersedes the earlier **most recent unread** opening rule in `chat-unread-opening.md`.

## Behavior

A room or private conversation opens at its oldest incoming unread message. Room replies resolve to their visible root and then open the exact immediate parent thread, including nested branches. An ordinary selected thread opens at its oldest unread direct child. The target has a persistent “Unread starts here” label and outline; the cue does not move keyboard focus. No unread messages means latest history without an unread cue. Explicit pins, notification/deep links and subsequent user navigation take precedence over automatic opening.

The existing downward arrow fetches fresh latest history, then advances the read marker only after the visible jump succeeds. Its captured maximum includes reply-only room messages. Replies expose the same **Skip to latest room message** action, closing the thread; they do not introduce a separate thread read marker. A selected thread only reports an initial room read boundary when its unread child is also the global oldest incoming unread. Opening another branch cannot clear earlier unread elsewhere.

Room roots use at most 80 rows and direct replies at most 100. Additive `around`, `before`, `after` and fixed `range` query modes provide contiguous sequence windows with Earlier/Newer controls. They retain the existing room access, parent scope, membership projection and canonical removed-row evidence. The existing pin `anchor` mode remains unchanged. Historical reconciliation uses the same coordinator and fixed range, and ignores unrelated out-of-range realtime inserts. No new poller, timer, SQL schema or notification mutation is added.

Unavailable ancestor chains are searched within a bounded candidate page (80 candidates, at most 20 cached parent lookups). If no valid unread target can be established, opening fails with a retry message and keeps reads paused; it does not silently claim there is no unread. Empty historical ranges retain their sequence bounds and neighbor controls. An empty raced paging response leaves the prior context available with a Latest recovery message.

Successful sends from historical windows refresh a bounded latest window with the own acknowledgement visible. The automatic send reveal keeps a conservative room read hold. Layout changes, programmatic scrolling and the acknowledgement itself cannot release it. Explicit Latest clears it; deliberate history gestures can read only through the then-rendered boundary. Failed sends keep the draft/window. A successful send followed by a history-refresh failure retains its acknowledgement and offers Show sent message/reply, without treating it as an unsent message.

## Compatibility and limits

The opening response keeps `messageId` and `readThrough`, with additive exact child/parent and latest snapshot fields. `readThrough` is conservative for older clients. Existing reader response shapes and pin anchors remain compatible. Default thread selection now uses its stable unread sequence rather than timestamps, so equal-timestamp replies still select the actual latest 100; room and DM defaults remain unchanged. The shared room marker remains monotonic; exact visible-notification acknowledgements, pinned unread totals, auth/SS membership, blocks, deleted/tombstone semantics, send idempotency and release safeguards are not redefined.

No animation or focus target is added to the unread cue. Native keyboard behavior remains OS/browser controlled. Local browser evidence uses Chromium emulation; it does not establish physical Safari/iOS or Android keyboard behavior.

## Local verification

Synthetic current-schema PGlite/Auth fixture: 54573. Production Next: 3373. The public fixture URL/anon key are supplied at build and start; only the existing fixed membership-export destination is redirected to the synthetic source. No production data or credentials are used.

- Full unit suite: 988 tests / 119 files; focused opening/window/route coverage includes bounded context, 80/81/100 boundaries, current room/parent scope, tombstones/removals, invalid cursors, unavailable ancestors, oldest ordering, shared thread cursor safety and independent latest maximum.
- TypeScript and production build pass. Lint: zero errors, the existing ten warnings.
- Current-schema room unread database regression passes. The 71 release-service tests pass; the migration-free plan's unauthenticated login probe is smoke coverage only.
- Production browser verifies oldest unread outside the initial 80-root/50-DM pages, exact depth-three reply opening with over 100 children, bounded pagination, conservative initial markers, explicit Latest/read/reopen, reply-only latest boundaries, three themes, portrait/landscape, desktop/mobile Quad, held Latest with later arrivals, repeated Latest followed by a normal visible arrival, user scroll cancellation and draft preservation. It also covers historical send failure and same-client retry, a retained successful acknowledgement after refresh failure, conservative send read holds, current SS authorization, and deletion of every row in a historical window.
- Reviewed race regressions pass in the production browser: initial opening aborted by another Quad pane retries on return; superseded root/reply paging releases its controls; inactive-pane following survives settled composer typing without acknowledging unread; and ordinary selected-thread navigation confirms only its exact visible global-oldest reply.
- Existing production pinned-message jump regression passes: historical/root/reply/repeated navigation, three themes, reduced motion, mobile touch, held-response cancellation, Quad isolation and drafts.
- Existing actual-component opening and mobile-send regressions pass, including delayed acknowledgements, caret/draft preservation and user navigation.
- Existing actual-component Latest regression passes with its fixture updated for the additive around/Latest parameters. It covers exact read boundaries, Quad isolation, failed fetches, held sends, realtime/edit races and keyboard/mobile actions.

Evidence logs use `/tmp/chat-start-unread-{focused,unit,tsc,lint,build,database,release,browser,skip-regression,opening-regression,mobile-send-regression,pin-regression}.log`; screenshots use `/tmp/chat-start-unread-{dark,light,blade-runner}-{390,844}.png` and `-quad.png`. Production scripts are `scripts/tests/chat-start-unread-{fixture,preload,browser}.mjs`. Final evidence and owned-server shutdown are confirmed in the local handoff. Publication remains solely with the dedicated release service.
