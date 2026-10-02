// Synthetic current-schema database/auth adapter only; no production data.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-self-identification-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-shortscout-authorization-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll("||'54555'","||'54562'").replaceAll("||'3355'","||'3362'");
source=source.replace("'20261001190002_chat_shortscout_authorization.sql'","'20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql','20261002140651_chat_room_message_pins.sql'");
source=source.replace("['chat_member_membership_sources'","['longboard_chat_room_members_ordered','longboard_chat_room_members','chat_member_membership_sources'");
// Same local realtime and historical seed adapters as the published nested-count fixture.
source=source.replace("source=source.replaceAll('54404'",`source=source.replace("now()+($3 * interval '1 second')","now()-interval '1 day'+($3 * interval '1 second')");\nsource=source.replaceAll('54404'`);
source=source.replace("return send((await db.query(payload.sql,payload.args||[])).rows);","const rows=(await db.query(payload.sql,payload.args||[])).rows;if(payload.broadcast)for(const row of rows)broadcast(payload.broadcast,row);return send(rows);");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
