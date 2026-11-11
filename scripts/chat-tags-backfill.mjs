#!/usr/bin/env node
// #439 backfill, run once after 20261111120000_chat_tags_follow_person.sql is applied: calls
// chat_tags_backfill_step in small batches with a pause between them, so the database never takes
// one large write (a big bulk write once filled the disk with WAL and froze chat writes, 11-09).
// It only adds rows to chat_member_names and chat_message_tags; it never changes messages and never
// creates notifications. Safe to stop and start again: progress is kept in chat_tags_backfill.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/chat-tags-backfill.mjs [--batch 500] [--pause 1000]
//
// Prints the progress row after each batch (counts only, no names or text). The final line gives
// messages scanned, names added, messages tagged, tags added and `ambiguous` (tags left alone because
// two members have had that name and the message's notification does not say which one was meant).
import { createClient } from '@supabase/supabase-js';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : Number(args[i + 1]); };
const batch = opt('--batch', 500), pause = opt('--pause', 1000);
if (!(batch >= 1 && batch <= 5000) || !(pause >= 0)) throw Error('--batch 1-5000, --pause >= 0 (ms)');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const db = createClient(url, key, { auth: { persistSession: false } });
const show = s => `${s.phase} scanned=${s.scanned} names_added=${s.names_added} messages_tagged=${s.messages_tagged} tags_added=${s.tags_added} ambiguous=${s.ambiguous}`;
for (;;) {
  const { data, error } = await db.rpc('chat_tags_backfill_step', { p_limit: batch });
  if (error) throw Error(`chat_tags_backfill_step: ${error.message}`);
  console.log(show(data));
  if (data.phase === 'done') break;
  await new Promise(r => setTimeout(r, pause));
}
