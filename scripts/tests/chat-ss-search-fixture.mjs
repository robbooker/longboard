// Synthetic current-schema Auth/SQL/realtime fixture plus this exact migration.
import {readFile,writeFile,unlink} from 'node:fs/promises';
process.env.CHAT_FIXTURE_PORT||='54574';process.env.CHAT_APP_PORT||='3374';
const target=new URL(`.chat-ss-search-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-notification-list-fixture.mjs',import.meta.url),'utf8');
source=source.replace("'20261002152103_chat_notification_list.sql'","'20261002152103_chat_notification_list.sql','20261002153528_chat_phone_notification_layout.sql','20261006134004_chat_shortscout_search.sql'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
