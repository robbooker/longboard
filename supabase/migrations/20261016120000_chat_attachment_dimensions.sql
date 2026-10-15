-- MEDIA-SIZE: the pixel size of each shared image, so a message reserves the image's box
-- before anything loads and nothing grows after it appears.
-- Written by the server when the upload is checked (POST /api/chat/attachments/[id]): sharp
-- reads the size from the scanned file itself (rotation applied), never from the browser.
-- Both columns stay empty for PDFs, voice notes and files shared before this change; those
-- images use the existing preview_width/preview_height, or a fixed placeholder box.
-- The app works before and after this runs: it falls back to the preview columns when these
-- columns are missing. Metadata only (no table rewrite, no backfill, no lock beyond a moment).
alter table public.chat_attachments
  add column width integer,
  add column height integer,
  add constraint chat_attachments_dimensions_check check (
    (width is null and height is null)
    or (width between 1 and 20000 and height between 1 and 20000)
  );
