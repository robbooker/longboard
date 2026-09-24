// Synthetic local fixture. No production credentials or data.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-pins-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-membership-alignment-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54535','54543').replaceAll('3335','3343');
source=source.replace('await writeFile(target,source);',`source=source.replace('function user(p)',\`await db.exec(await readFile(root+'/supabase/migrations/20260919172700_chat_favorite.sql','utf8'));await db.exec(await readFile(root+'/supabase/migrations/20260924133714_chat_conversation_pins.sql','utf8'));\nfunction user(p)\`);\nawait writeFile(target,source);`);
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
