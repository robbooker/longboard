# Clipboard image filename compatibility

Ticket: `68c1ab32-039a-47ac-a3fe-9a2a65eb5057` (PASTE IMAGE).

The room, reply, and existing-DM composers already forward paste events to
`useAttachments`. The extraction helper accepted supported image bytes but kept
any nonempty clipboard filename. The upload validator requires a compatible
extension and a safe filename. An image/png named `image`, `image.tiff`, or
`Screenshot/Today.png` was consequently rejected before a preview or upload.

Normalize incompatible clipboard filenames to `pasted-image.<MIME extension>`.
Preserve valid names and original bytes. This applies to every composer through
the shared helper; file-picker rules, server signature checks, malware scanning,
size/count limits, and room/DM posting permissions are unchanged. Unsupported
formats such as TIFF continue to show JPEG/PNG/GIF guidance. This is a reproduced
compatibility defect, not confirmation of the original user's exact clipboard
producer or a claim that WebKit-only formats are converted.

Verification:

- 64 clipboard, validation, attachment API, DM attachment API, cleanup, and preview
  tests passed. New clipboard tests run against the original helper produced
  seven failures; they pass with the fix.
- `tsc --noEmit` and changed-file ESLint passed.
- `node scripts/tests/chat-clipboard-browser.mjs` passed in Chromium on localhost
  port 3340 (override with `CHAT_CLIPBOARD_PORT`). The isolated browser harness
  mounts the actual shared hook and tests trusted Ctrl+V PNG events, previews,
  upload/scanning states, room/DM scope metadata, malformed filenames, unsupported
  TIFF guidance, rejected scans blocking Send, and native ordinary-text paste.
- Browser API/storage/scanner responses are test fixtures. It does not exercise
  the complete composer UI, production scanner, macOS Cmd+V, or native WebKit.
