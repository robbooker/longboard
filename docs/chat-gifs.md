# GIFs in the public chat

The existing `/chat` room supports GIPHY GIF links. Click **GIF**, paste a GIPHY share or media link, preview it, and choose **Add to message**. Add an optional caption and press Send. Pasting a supported link directly into the composer also works.

The first supported GIF in a message renders as a still image with an explicit Play/Pause button. Animation never starts automatically, including for users who prefer reduced motion. A source link remains available if the media fails to load. Extra GIF links remain clickable text. GIF links and captions share the existing 600-character limit.

`lib/chatGifs.ts` parses supported GIPHY share, embed and media URLs into a validated ID and constructs canonical media URLs. Arbitrary image hosts, credentials and non-HTTPS URLs are not embedded. No server URL fetching, new API credentials, database changes or additional message fields are involved. Existing chat authentication, pause controls, rate limits, message storage and reactions apply. Private messages are unchanged.

This version does not include uploads or an in-app GIF search library. Those can be added separately with a provider integration. `ChatGif` and the parser can be reused for future rooms.

## Verification (September 15, 2026)

- 159 application tests pass, including share/media parsing and untrusted URL rejection.
- Production build passes (existing unrelated lint warnings remain).
- Local browser against isolated PGlite fixtures: sign in, paste and preview, append to caption, send through existing API, reload saved history, play/pause, recover draft after simulated 503.
- 390px phone viewport: loaded GIPHY still frame, no horizontal overflow or application errors; screenshot at workspace `chat-preview/gifs-mobile.png`.
- No production messages or accounts created. GIF changes have not been deployed.
