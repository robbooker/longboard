// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// ROOM-NOTIFY: the shared chat fixture on this test's ports. ROOM_NOTIFY_PREMIGRATION=1 leaves the
// room-levels migration out, to check the app before that migration is applied.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-room-notify-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54596').replaceAll('3204','3396');
if(process.env.ROOM_NOTIFY_PREMIGRATION==='1')source=source.replace("const productionOnly=['","const productionOnly=['20261015180000_chat_room_notification_levels.sql','");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
