# Compact DM formatting follow-up

Requested directly by Rob on September 23 after PR336: left-aligned messages had unpadded full-width blue backgrounds and empty reaction rows. Keep left alignment and normal content growth, restore 12px/14px padding and rounded borders, soften outgoing blue to a 9% tint with readable dark text, and put the existing compact reaction trigger in the header. Empty reaction wrappers use display:contents so they add no grid row; actual chips and dialogs remain functional.

Validation: TypeScript and targeted ESLint passed; 22 membership/identity unit tests passed. The actual-component browser matrix passed at320/390/768/1440 in light/dark themes, including768x540 short viewport. Checks cover compact short-message height, zero-height empty footer, aligned/padded bodies, no overflow, media preview/upload, reaction add/remove and keyboard focus, editing and pending-send confirmation. Native WebKit with synthetic ephemeral login also verified content-sized messages and empty footer height0. Fixture limitations from chat-dm-alignment.md still apply. Production build/release checks remain pending.

Tracking authorized explicitly by Rob after the initial workflow rejection. Ticket91ee9ffd-7bef-41df-9290-3b5f168d52cd. No migration; login HTTP200 probe. Publication must use the dedicated release service.
