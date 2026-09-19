# S05: small private attachment previews and metadata batches

Small inline image previews use a distinct authorized thumbnail endpoint. Originals are fetched only when a person opens or downloads them. The preview service produces static WebP images at most640px/150,000bytes from successfully scanned bytes, strips metadata, and preserves GIF animation in the original. Legacy images generate their derivative lazily from the immutable clean object after SHA256 verification.

A service-only additive migration stores preview dimensions, path and render lease. Concurrent generation uses compare-and-set leases; decoding has pixel/time/concurrency limits. Cleanup is registered before upload, with delayed object removal on cancellation, replacement or deletion. Authorization and live parent binding are rechecked after generation. Unsafe/unsupported previews fail closed with explicit original-on-demand fallback; decode limits may mean unusually large images have no inline preview.

Visible attachments request metadata in20ms batches, at most60 IDs per authorized room or DM. The account-owned memory cache holds at most300 files for30seconds. No room/DM mixing, localStorage or process-global private metadata. Authentication loss clears all scopes and rejects stale inflight responses; individual access errors clear the affected scope. Room metadata now also verifies each file remains attached to its live parent message.

Thumbnail dimensions reserve the correct display aspect before decoding. Unknown legacy dimensions use a temporary bounded frame until metadata becomes available. No physical-device Safari test has been performed.

## Verification

Unit, route and database tests cover scan gating, invalid images, animated GIFs, bounded output, private access, parent deletion, lease/cancellation races, cleanup and cache account/scope invalidation. Independent read-only security review found no blocking issue.

Publication requires the dedicated service and exact-version owner approval; no production migration has been applied by desktop workers.

## Final client verification

Synthetic browser checks batched six attachment IDs from two visible DM messages into one metadata request. The room check batched three separate messages into one three-ID request. A synthetic 1800×1800 random-RGB PNG was 9,739,098 bytes; its static WebP thumbnail was 130,120 bytes. The synthetic GIF thumbnail was 224 bytes. These are synthetic payload measurements, not real-photo benchmarks or end-to-end speed percentages.

No original image request occurred until explicit enlargement; the GIF original route loaded only when opened. An unavailable thumbnail showed an explicit action and never silently fetched the original. Keyboard enlargement/Escape focus restoration and nonparticipant thumbnail denial passed. Three-image frame dimensions stayed unchanged during deliberately delayed thumbnail decode. Desktop and mobile emulation checks passed; no physical Safari/device test was performed.

Initial metadata arrival can resize unknown-type/dimension placeholders for any image: message history currently supplies attachment IDs rather than dimensions. Once metadata establishes the bounded aspect frame, image decode does not resize it. This does not claim zero metadata-arrival reflow. Offscreen metadata is observed lazily, cached only within the account-owned provider, and invalidated on access failure; account disposal aborts outstanding requests. HTTP401 also invalidates other scopes and rejects their older in-flight responses.

Parent validation: 572 unit tests across 79 files passed, TypeScript and lint passed, and 71 release-service regressions passed. Final production build passed (exit 0), `/tmp/s05-production-build.log`. Browser logs: `/tmp/s05-attachments-browser.log`, `/tmp/s05-room-attachments-browser.log`, `/tmp/s05-image-bounds-browser.log`.
