-- Eligible announcement readers may react; announcement posting stays admin-only.
-- Reactions remain guarded by shortscout_reaction_admin (current room entitlement)
-- and longboard_chat_reactions_require_open (paused-room enforcement), including
-- privileged writes. Browser roles retain their existing read-only grants/RLS.
drop trigger announcement_reaction_writer on public.longboard_chat_reactions;
