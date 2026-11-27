// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// ROOM-NOTIFY: the shared chat fixture on this test's ports. ROOM_NOTIFY_PREMIGRATION=1 leaves the
// room-levels migration out, to check the app before that migration is applied. Later migrations
// that build on its table (the faster bell, 20261019150000, and Gainers push, 20261020130000, read chat_room_notification_levels)
// can only run after it, so they are left out too: the database is as it was before ROOM-NOTIFY.
// Room-adding migrations that rewrite its room-slug check (LB Review, What's New, Developers,
// #386 Booker Stock Club) need its table too, so they are left out as well, and so is the #391
// faster bell (20261110100000), which reads the room levels and the Booker Stock Club room rule.
// #443 What's New pictures (20261111143000) alters the What's New tables, so it goes with #302.
// #457 club admin posts (20261115120000) rewrites the club guard and two room-slug checks as #386
// and Runner Watch left them, so it goes with #386. #482 AI Insights (20261121130000) checks those room
// rules are exactly production's before adding its room, so it is left out too. #524's webinar
// notices (20261126120000) checks the club guard and queue_chat_push the same way, so it is too.
// #537's Webinars rooms (20261127130000) check the room rules, the room-slug checks and the functions
// those migrations left, and build on #524's table, so it is left out as well.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-room-notify-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54596').replaceAll('3204','3396');
if(process.env.ROOM_NOTIFY_PREMIGRATION==='1')source=source.replace("const productionOnly=['","const productionOnly=['20261127130000_chat_webinars_room.sql','20261126120000_chat_stage_broadcasts.sql','20261121130000_chat_ai_insights.sql','20261115120000_chat_club_admin_posts.sql','20261111143000_chat_whats_new_pictures.sql','20261110140000_chat_runner_watch.sql','20261110100000_chat_activity_inbox_faster.sql','20261109120000_chat_stock_club.sql','20261102180000_chat_improvement_suggestions.sql','20261102120000_chat_activity_inbox_stop_early.sql','20261101100000_chat_faq_reanswer.sql','20261031120000_chat_lb_review.sql','20261031100000_chat_faq_review.sql','20261030220000_chat_faq.sql','20261015180000_chat_room_notification_levels.sql','20261019150000_chat_activity_inbox_fast.sql','20261020130000_chat_gainers_push.sql','20261023200000_chat_whats_new_room.sql','20261029150000_chat_developers_room.sql','");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
