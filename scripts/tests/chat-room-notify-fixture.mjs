// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// ROOM-NOTIFY: the shared chat fixture on this test's ports. ROOM_NOTIFY_PREMIGRATION=1 leaves the
// room-levels migration out, to check the app before that migration is applied. Later migrations
// that build on its table (the faster bell, 20261019150000, and Gainers push, 20261020130000, read chat_room_notification_levels)
// can only run after it, so they are left out too: the database is as it was before ROOM-NOTIFY.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-room-notify-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54596').replaceAll('3204','3396');
if(process.env.ROOM_NOTIFY_PREMIGRATION==='1')source=source.replace("const productionOnly=['","const productionOnly=['20261101100000_chat_faq_reanswer.sql','20261031120000_chat_lb_review.sql','20261031100000_chat_faq_review.sql','20261030220000_chat_faq.sql','20261015180000_chat_room_notification_levels.sql','20261019150000_chat_activity_inbox_fast.sql','20261020130000_chat_gainers_push.sql','20261023200000_chat_whats_new_room.sql','20261029150000_chat_developers_room.sql','");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
