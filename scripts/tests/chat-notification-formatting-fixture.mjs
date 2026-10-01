// Extend the existing isolated chat protocol fixture with the new migration.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-notification-wrapper-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-delete-replies-fixture.mjs',import.meta.url),'utf8');
// The shared scroll fixture seeds 80 Bob messages. Make that historical data old
// enough for the actual send endpoint's unchanged ten-minute rate limit.
source=source.replace("source=source.replaceAll('54404'",`source=source.replace("now()+($3 * interval '1 second')","now()-interval '1 day'+($3 * interval '1 second')");\nsource=source.replaceAll('54404'`);
source=source.replace("'20261001161221_chat_delete_replies.sql'","'20261001161221_chat_delete_replies.sql','20261001170025_chat_notification_formatting.sql'");
source=source.replaceAll('.chat-delete-replies-fixture-','.chat-notification-formatting-fixture-');
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
