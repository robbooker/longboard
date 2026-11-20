-- Rollback for 20261120130000_chat_six_column_widths.sql (#470 Six view column widths). Members'
-- saved widths are lost; Six falls back to the copy in each browser (or even columns).
alter table public.chat_card_layouts drop column if exists widths;
