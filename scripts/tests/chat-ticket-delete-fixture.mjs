// Local synthetic fixture; uses the same current auth and archive projection as the app.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-ticket-delete-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-archive-order-fixture.mjs',import.meta.url),'utf8');
source=source.replace("'20261002125758_chat_feature_archive_order.sql'","'20261002125758_chat_feature_archive_order.sql','20261002140651_chat_room_message_pins.sql','20261002150404_chat_ticket_delete.sql'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
