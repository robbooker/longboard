# Message reaction footer

Approved request `9bb52d03-3081-47d6-8828-cfa8c5292e77`, revision 2.

The existing Like/reaction control and count now occupy the lower-right of each room message, opposite the lower-left Reply/thread-count link. Timestamp and message actions remain above the message body. The footer spans the message grid and leaves content unobscured at narrow widths. LB and Social use a palm; ShortScout uses a lemon. These are room-specific icons for the same existing reaction toggle, not separate competing Like actions.

The existing authenticated toggle, active state, count, pending/paused disabling, error rollback and liker-name tooltip are reused. Accessible labels name the room's icon and like count; errors use the general term reaction. No migration or API change.

Verification: TypeScript, targeted lint and production build. Run the isolated fixture and local server described in chat-mobile-replies.md, then `node scripts/tests/chat-reaction-footer-browser.mjs`. The browser test covers all three rooms at 320,390,1280,1920px, reactions below content/timestamps and right of Reply, no overflow, palm/lemon icons, like/unlike actions, liker tooltips, Reply navigation and no page errors. Screenshots: /tmp/reaction-footer-main.png, /tmp/reaction-footer-social.png, /tmp/reaction-footer-shortscout.png. Dummy accounts only; no live messages or reactions changed.
