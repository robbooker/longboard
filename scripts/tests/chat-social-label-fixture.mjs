// Existing synthetic current-schema fixture plus the published Phone preparation migration.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-social-label-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-notification-list-fixture.mjs',import.meta.url),'utf8');
source=source.replace("'20261002152103_chat_notification_list.sql'","'20261002152103_chat_notification_list.sql','20261002153528_chat_phone_notification_layout.sql'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
