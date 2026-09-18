// Isolated directory fixture with Zoe registered but no public posts or DMs.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-dm-directory-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54462').replaceAll('3204','3262');
source=source.replace("['Alice','Bob','Mallory']","['Alice','Bob','Mallory','Zoe']");
source=source.replace(" await db.query('insert into longboard_chat_messages(guest_id,member_id,author_label,body)"," if(p.name!=='Zoe')await db.query('insert into longboard_chat_messages(guest_id,member_id,author_label,body)");
source=source.replace('const objects=new Map()',`for(const file of ['20260917231136_chat_dm_message_actions.sql','20260918001755_chat_dm_media.sql','20260918115352_chat_dm_directory.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
const objects=new Map()`);
source=source.replace("['chat_thread_counts',","['longboard_chat_dm_directory','chat_thread_counts',");
source=source.replace("v.slice(1,-1).split(',').map(bind).join(',')","v.slice(1,-1)?v.slice(1,-1).split(',').map(bind).join(','):'null'");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
