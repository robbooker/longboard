# Edit/Delete action menu dismissal verification

Passed September 20, 2026 with `node scripts/tests/chat-action-menu-dismiss-browser.mjs`.

The fixture bundles the actual MessageActions and DirectMessageActions React components and their CSS. It runs Chromium on a dynamically allocated localhost port, with synthetic messages and mocked successful/failed API responses. It makes no production requests.

Verified room actions, thread edit-only actions, administrator delete, and direct-message actions:

- Choosing Edit or Delete closes the disclosure before native showModal executes.
- Outside mouse clicks and emulated touchscreen taps close it without stealing focus from another input.
- Clicking inside menu padding does not dismiss it; disabled Edit remains disabled and leaves the menu open.
- Enter opens the summary, Tab reaches action buttons, Enter selects, and Escape dismisses the menu and restores summary focus.
- Modal Escape, Cancel, and successful submission restore summary focus. Server error responses retain the modal while its originating disclosure stays closed.
- The document has one pointerdown listener while a menu is open, none at rest, and none after unmounting an open menu.
- No browser page errors occurred.

A screenshot of the editor was visually inspected: the disclosure is closed behind the modal. Screenshots are temporary local evidence at `/tmp/chat-action-menu-dismiss-open.png` and `/tmp/chat-action-menu-dismiss-edit.png`; they are not production styling evidence because the synthetic fixture omits application theme variables.

Limits: Chromium touch emulation is not physical iPhone/Safari verification. API outcomes are synthetic; this checks interaction and focus behavior, not server authorization or production persistence. Existing S06 regression coverage and broader project checks are reported separately by the coordinating worker.
