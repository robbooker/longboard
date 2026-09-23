// Reuse the isolated membership fixture; never reads production data or credentials.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-dm-alignment-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-membership-alignment-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54535','54536').replaceAll('3335','3336');
source=source.replace("'20260918182625_chat_voice_messages.sql'","'20260918182625_chat_voice_messages.sql','20260919002508_chat_attachment_previews.sql'");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
