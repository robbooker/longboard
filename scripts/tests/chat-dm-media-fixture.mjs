// Isolated adapter: extend the shared synthetic fixture without changing its ports or schema.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.dm-media-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54424').replaceAll('3204','3224');
source=source.replace('const objects=new Map()',`for(const file of ['20260917231136_chat_dm_message_actions.sql','20260918001755_chat_dm_media.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
const objects=new Map()`);
source=source.replace("v.slice(1,-1).split(',').map(bind).join(',')","v.slice(1,-1)?v.slice(1,-1).split(',').map(bind).join(','):'null'");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
