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

## Searchable picker (in development)

Set `NEXT_PUBLIC_GIPHY_API_KEY` to the browser API key from a Longboard web app in the [GIPHY developer dashboard](https://developers.giphy.com/dashboard/). Add it to Vercel Preview and Production and rebuild. This key is intentionally used in browser requests, as required by GIPHY; do not substitute a server secret. The local environment currently has no real key, so live-provider verification and activation are pending.

The picker shows trending GIFs, debounced search (50 characters), twelve results per page, Load more, selection preview, and the existing caption/send flow. PG rating is requested. Escape closes the picker; Enter inside search never sends a chat message. Search requests are cancelled when the query changes or picker closes. Without a key the paste-link flow remains available.

API calls and media loads go directly from the browser to GIPHY. API-returned media URLs are preserved. Messages store the GIPHY share link (ID); with the integration configured, the player resolves current media metadata by ID rather than storing provider media responses. No media proxy or server cache is added. The picker uses the official static attribution mark from https://media.giphy.com/giphy-attribution-marks.zip.

GIPHY beta keys are limited to 100 API calls/hour per the current documentation. Request a production upgrade for the intended room traffic; production access/pricing is determined by GIPHY. See https://developers.giphy.com/docs/api/quick-start-guide/.

Picker verification: 166 tests pass; production build passes. Browser checks with mocked GIPHY responses and an isolated local chat database cover trending/search, empty results, Enter staying inside search, selection preview, adding the share link to the composer, and a 390px viewport without horizontal overflow. No real API key was used; provider authentication, live result availability and production quotas remain unverified.
