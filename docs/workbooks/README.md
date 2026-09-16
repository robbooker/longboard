# Interactive workbooks

The first workbook lives at `/workbooks/act-your-way`, linked as a featured worksheet in the member library. Visitors can read the lesson; a member account is required to enter answers. Login returns to the requested workbook.

## Adding a workbook

Add a `WorkbookDefinition` to `lib/workbooks/definitions.ts`, with a permanent slug and stable prompt IDs. Then add a worksheet resource in `lib/library/resources.ts`. The route, UI, validation, progress, autosave and print view are shared. Do not rename existing prompt IDs or change the evidence count without migrating existing responses.

## Saving and privacy

`GET/PUT /api/workbooks/[slug]` authenticates with the existing account helper. `workbook_responses` stores one JSON response per user and workbook. Row-level policies restrict selects, inserts and updates to the owner; anonymous access and client deletes are not granted. No service-role key is used by this feature.

Saves are debounced and serialized. Revision checks reject stale devices/tabs with HTTP 409. Load failures keep editing disabled; save failures retain edits in memory and offer retry. Unsaved edits trigger the browser's leave-page warning. There is no persistent offline draft: a tab closed before saving may lose its unsaved changes. A conflict requires printing/copying the local edits before reloading the saved version.

## Event and printing

Use `/workbooks/act-your-way` as the target of the event QR code. The Print / Save as PDF button opens the browser print dialog. The print stylesheet uses full response text instead of textarea viewports, so long answers remain visible.

## Validation

Run `npm test -- lib/workbooks/__tests__` and `npx tsc --noEmit`. API tests cover account ownership, failed loads, invalid payloads, and revision conflicts. Database verification SQL in `rls-verification.sql` exercises owner and non-owner access inside a rolled-back transaction; it requires two existing auth users and makes no lasting writes.

## Verification in this change

- Production build, TypeScript, and lint on changed files passed. The full build reports existing warnings in unrelated components.
- Nine targeted tests passed. The Puppeteer check (`node scripts/verify-workbook.mjs`, with a running local server) covers fill, autosave, editing during a save, reload, progress, mobile overflow, printing, retries, and conflict protection using simulated account API responses.
- Real Supabase policies passed the rolled-back RLS verification; no test rows remain. The security advisor returned no findings for the workbook table. A complete browser login/save cycle against a real member account still needs a signed-in preview check.
- The migration was applied to the Longboard Supabase project on September 9, 2026. The website change remains on its feature branch for preview review.
- The requested legacy CSS-variable audit found 23 existing files, including protected shared styles and components with their own local variables. No workbook styles use those variables and no shared styling was changed.
