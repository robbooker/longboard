// Isolated synthetic authentication; no production credentials or mutations.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.jammie-fixture-${process.pid}.mjs`,import.meta.url);
const migration='20260928120621_chat_jammie_development_approval.sql';
const source=(await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8'))
 .replaceAll('54404',process.env.TEST_REST_PORT||'54548').replaceAll('3204',process.env.TEST_CHAT_PORT||'3348')
 .replace('function user(p)',"await db.exec(await readFile(root+'/supabase/migrations/20260921202321_chat_shortscout_membership_links.sql','utf8'));\nfunction user(p)")
 .replace("await db.query(\"insert into chat_feature_members",`await db.exec(await readFile(root+'/supabase/migrations/${migration}','utf8'));\nawait db.query("insert into chat_feature_members`)
 .replace("values($1,'owner'),($2,'participant')", "(account_id,role) values($1,'owner'),($2,'participant')");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
