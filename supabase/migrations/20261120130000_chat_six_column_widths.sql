-- #470 Six view column widths: each member's column widths in Six, kept with their card layout so
-- Six opens with the same widths on every computer they sign in on.
--
--  * chat_card_layouts.widths: null (the standard even layout) or a JSON list of three shares of the
--    width, e.g. [0.5, 0.25, 0.25]. Read and written only by /api/chat/card-layout with the service
--    role, for the signed-in account (the route checks and rounds the shares before saving).
--  * The table already has RLS on with no policies, and the service role's grants are table-wide,
--    so nothing about access changes. No functions or views are added.
--
-- Additive: one nullable column; existing rows read as even. Until it is applied, Six still works:
-- the route leaves widths out and the page keeps them in the browser only.
-- Rollback: supabase/rollbacks/20261120130000_chat_six_column_widths.down.sql

alter table public.chat_card_layouts
 add column if not exists widths jsonb
 check(widths is null or (jsonb_typeof(widths)='array' and jsonb_array_length(widths) between 1 and 12 and pg_column_size(widths)<1024));
