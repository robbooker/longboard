// Synthetic current-schema auth/database adapter; no production connections.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-user-name-updates-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-shortscout-authorization-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll("||'54555'","||'54558'").replaceAll("||'3355'","||'3358'");
source=source.replace("'20261001190002_chat_shortscout_authorization.sql'","'20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql'");
source=source.replace("['chat_member_membership_sources'","['longboard_chat_room_members_ordered','longboard_chat_room_members','chat_member_membership_sources'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
