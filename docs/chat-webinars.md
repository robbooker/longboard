# Embedded webinars — planning notes

Attachments remain the first build priority. Webinar embedding is planned, not implemented or purchased.

## Existing page

`components/command2/CommandCenterV2.tsx` has a Morning Webinar placeholder in the right rail directly above `BoardroomChat`. That chat was separate from the `/chat` component. A pending change replaces the command2 panel with the canonical `/chat?room=main&popout=1` experience, preserving the shared login, room permissions and features. Existing cohort history is retained in its original tables; it is not copied into the broader LB MAIN audience. Webinar integration should use the shared room system rather than create a third chat implementation. The page reads current-user data, but the new player must enforce its own event/community access server-side.

## Proposed architecture

An event record holds community/access rules, title, scheduled time, provider and stream/playback reference, status, shared chat-room ID, recording and transcript references. Keep video delivery with a dedicated provider; use our app for membership, room permissions, navigation and saved chat. Never expose a broadcasting stream key to viewers. Validate provider webhook signatures and make event state updates idempotent.

The widget shows upcoming, live, interrupted and replay states. A full-size watch view and popout chat complement the small command2 rail. Both Longboard and ShortScout can use the same player component with separate event permissions. A chat transcript is distinct from a transcript of the spoken webinar; spoken transcripts require recording/caption processing.

## Candidate technologies

- Mux latency: standard typically 25–30 seconds; reduced 12–20 seconds; low latency as low as 5 seconds, varying by viewer/network. Do not promise a five-second upper bound.
- Zoom embedding is supported through the Meeting SDK, not by dropping a standard meeting link into an iframe. Component view is desktop-only; mobile/tablet requires client view.
- Mux: candidate for a custom one-presenter-to-many experience. Signed playback allows our app to authorize viewing. Recording/replay and broadcast latency need testing with the actual host workflow. It is not a replacement for an interactive two-way meeting platform.
- Zoom Meeting SDK: candidate if Rob already hosts on Zoom and members need the Zoom meeting/webinar experience inside the site. Verify plan, account/app requirements and webinar SDK feature support before selecting it.
- Vimeo live embed: candidate for a simpler hosted player workflow. Domain embed restrictions alone do not implement our membership authorization; evaluate privacy and plan capabilities.

Confirmed: viewers only watch and ask questions in chat. Decision inputs still needed: current host software, typical/peak attendance, session length/frequency, acceptable screen-sharing delay, and recording/transcript requirements. Avoid committing to a provider or estimating cost before these are known.

Sources checked September 15, 2026:
- https://www.mux.com/docs/guides/secure-video-playback
- https://www.mux.com/docs/guides/live-streaming-faqs
- https://developers.zoom.us/docs/meeting-sdk/web/
- https://help.vimeo.com/hc/en-us/articles/12426942285841-How-to-embed-my-live-event-on-my-website

Latency reference: https://www.mux.com/docs/guides/reduce-live-stream-latency
