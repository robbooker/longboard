# Voice messages

Approved request: `f5eed634-7b29-477f-8528-0ef007f8bec1`.

A microphone beside the attachment controls records a voice draft in public rooms, reply threads, and accepted direct conversations. Stop previews the clip; Attach queues it through the existing scanner; Send remains explicit. Discard, denied permission, unsupported codecs, navigation, and unmount stop microphone tracks without clearing typed text. Pending DM requests remain text/GIF only until accepted. Announcement write permissions, paused rooms, and message identities are unchanged.

## Recording and storage

- Maximum 120 seconds and 5,000,000 bytes per voice clip; existing three-attachment/message and daily upload quotas remain.
- Browser MediaRecorder captures its native format (for example WebM/Opus or Safari MP4). The browser decodes that bounded local recording, resamples to mono 16 kHz, and uploads canonical PCM16 WAV. Compressed originals are not uploaded or retained. A recording at the time limit is trimmed to 120 seconds during normalization.
- The server accepts only a single canonical WAV data chunk, derives duration from actual aligned sample bytes, and rejects wrong rates, formats, declared sizes, extra chunks, truncation, and clips over the limit. Arbitrary uploaded MP3/WebM files cannot bypass normalization or validation. A canonical WAV file is an available attachment fallback.
- Every voice upload uses quarantine and the mandatory existing Transloadit malware scanner. Only the exact scanned bytes move to the immutable private clean path; an unscanned clip cannot attach to a message.
- Existing message body/ID/attachment IDs and edit/delete/replay semantics remain. Deleting a message removes attachment metadata, cascades its transcript, and queues storage deletion through the existing cleanup mechanism. Editing captions retains audio. Transcripts do not enter message bodies, Buddy, or search.

## Playback and transcription

Playback and download authorize the current account against the live linked message; voice DMs also require an accepted conversation and no block in either direction. The private redirect has no-store caching and a 60-second signed URL. As with existing private attachments, an already issued URL can remain usable for up to that 60-second lifetime; previously downloaded audio cannot be revoked.

The Transcript button sends audio to OpenAI only on request, using the existing server `OPENAI_API_KEY` and `gpt-4o-mini-transcribe` transcription endpoint. The UI discloses that provider processing and warns that text may be mistaken. Native playback remains available if transcription is unconfigured or fails. Cached transcripts are plain text; React escapes markup and renders no transcript HTML.

Service-only SQL claims serialize by attachment. Concurrent requests return processing or the cached result, rather than duplicate provider work. A two-minute lease supports interrupted requests; at most three provider attempts per file and 30 new claims per member per hour are allowed. Provider requests time out at 45 seconds and responses are bounded to 100 KB / 16,000 text characters. Browser cancellation aborts its fetch; already started server work may finish and cache a result, bounded by the provider timeout. Fresh account, room, conversation, block, and deletion checks run before claims/cache reads and again after provider completion. Token-conditional writes cannot overwrite another lease or resurrect a deleted attachment.

As documented by OpenAI on 2026-09-18, estimated `gpt-4o-mini-transcribe` pricing is $0.003/minute (about $0.006 for a full two-minute clip), excluding existing storage/scanning costs. Retries may incur another charge; successful cache reads do not. No live paid provider call was used for these tests.

Sources: [speech-to-text API](https://developers.openai.com/api/docs/guides/speech-to-text), [pricing](https://developers.openai.com/api/docs/pricing).

## Release and compatibility

CLI-generated migration: `supabase/migrations/20260918182625_chat_voice_messages.sql`; exact SHA-256 is pinned in `.release/f5eed634-7b29-477f-8528-0ef007f8bec1.json`. It depends on the existing attachment, DM media, and `chat_account_has_room` migrations already in the base. It adds nullable duration metadata and private transcript/usage tables, extends allowed MIME types, and grants only service-role execution of its invoker RPC. There are no new browser table grants or RLS policies.

The migration is safe to apply before the application: existing file records satisfy unchanged limits; previous application versions ignore the new column/tables and still reject WAV uploads. Apply only through the separately approved release process. This implementation did not apply any production migration or change credentials. A rollback leaves new recordings downloadable as ordinary files through the prior version, but removes the new recorder/player/transcript UI.

## Local verification

- Full unit/API suite: 511 tests across 72 files, including actual sample duration, malformed/truncated/multiple chunks, exact scan bytes, private playback, participant/block/decline/deletion/substitution checks, fresh authorization after transcription, cache deduplication, lease loss, limits, and provider failures.
- Isolated PGlite SQL suite: 27 assertions covering ready-state duration checks, unscanned rejection, participant and room access, revoked entitlement, both block directions, declined conversation, duplicate claim, lease/retry/usage limits, transcript cascade deletion, and anon/authenticated denial.
- Chromium fake-microphone browser flow records actual native audio and exercises browser normalization, scanner upload, explicit room/thread/DM sends, playback, cached transcript/reload, escaped transcript markup, discard, denied permission, and injected decode failure with preserved text and stopped tracks. Responsive screenshots at 320/390/768/1440 pixels are written to `/tmp/voice-*.png`.
- TypeScript, targeted ESLint, and production build pass. Two initial build attempts hit the shared temporary-disk quota (-122); a retry after disposable-cache cleanup exited 0. Existing unrelated build lint/Browserslist warnings remain.

Browser limitations: microphone capture requires a secure context and permission. Format support varies; unsupported recording/decoding shows a text/file fallback without losing the draft. Browser tests use desktop Chromium and mobile viewport emulation, not physical iOS/Safari or microphone hardware. Native Safari codec decoding was simulated failing; actual Safari MP4 capture still needs device validation. Closed/background tabs may suspend capture; this is an in-page recorder, not background recording. Test providers/scanner are synthetic fixtures, so live-provider quality, availability, and actual malware-engine compatibility have not been measured.
