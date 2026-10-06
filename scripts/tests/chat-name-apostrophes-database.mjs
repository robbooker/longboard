// Extend the existing actual SQL name/identity suite; synthetic PGlite only.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-name-apostrophes-database-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-user-name-updates-database.mjs',import.meta.url),'utf8');
source=source.replace('let checks=0;',`// Prove the original ASCII-only validator rejects a curly apostrophe.
await assert.rejects(()=>db.query('select chat_update_member_name($1,$2)',[accounts[0],'O’Neill']),/invalid_display_name/);
await db.exec(await readFile(root+'/supabase/migrations/20261006145455_chat_name_apostrophes.sql','utf8'));
let checks=1;`);
const extra=String.raw`
// All three glyphs remain exact, revisioned, idempotent, and searchable as literals.
for(const name of ["O'Neill",'O’Neill','O‘Neill']){
 const saved=await rename(accounts[0],name);eq(saved.display_name,name);eq(saved.id,members[0]);
 eq((await one('select display_name from longboard_chat_guests where id=$1',[members[0]])).display_name,name);
 eq((await rename(accounts[0],name)).name_revision,saved.name_revision);
 eq((await q('select * from longboard_chat_dm_directory($1,$2)',[accounts[1],name])).some(m=>m.id===members[0]),true);
 eq((await q("select * from longboard_chat_room_members($1,'social',null,$2)",[accounts[1],name])).some(m=>m.id===members[0]),true);
 eq((await q("select * from longboard_chat_room_members_ordered($1,'social',$2,array[]::uuid[],null,null,null)",[accounts[1],name])).some(m=>m.id===members[0]),true);
 const message=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob',$2,'social') returning id",[members[1],'Hello @'+name+'!']));
 eq((await q('select account_id from chat_room_mentions where message_id=$1',[message.id])).map(m=>m.account_id),[accounts[0]]);
}
const saved=await one('select display_name,name_revision from longboard_chat_members where id=$1',[members[0]]);
for(const invalid of ['’Anne','‘Anne','Anne<svg>','Anne\\Name','Anne“Name','Trader’SHIT','Fuck‘Trader',"O'; drop table profiles;--"]){await assert.rejects(()=>rename(accounts[0],invalid),/invalid_display_name/);checks++;}
eq(await one('select display_name,name_revision from longboard_chat_members where id=$1',[members[0]]),saved);
await rename(accounts[1],'O’Neill');
await assert.rejects(()=>rename(accounts[0],'o’neill'),/longboard_chat_member_name_idx/);checks++;
eq(await one('select display_name,name_revision from longboard_chat_members where id=$1',[members[0]]),saved);
// Distinct glyphs intentionally keep the existing literal uniqueness semantics.
eq((await rename(accounts[0],"O'Neill")).display_name,"O'Neill");
const fresh='00000000-0000-4000-8000-000000000004';
await q('insert into auth.users values($1)',[fresh]);await q("insert into profiles values($1,'fresh@example.test','user')",[fresh]);
await q("insert into user_tags values($1,'boardroom-cohort-1')",[fresh]);
const linked=(await one('select longboard_chat_link_member($1,$2,null) value',[fresh,'D’Arcy'])).value;eq(linked.display_name,'D’Arcy');
eq((await one('select longboard_chat_link_member($1,$2,null) value',[fresh,'Ignored'])).value.display_name,'D’Arcy');
eq((await one('select display_name from longboard_chat_guests where id=$1',[linked.id])).display_name,'D’Arcy');
console.log('PASS apostrophe baseline reproduction, exact glyphs/link/rename/mentions/search, collision rollback, unsafe input and unchanged name-identity suite.');
`;
source=source.replace('console.log(`PASS ${checks}',extra+'\nconsole.log(`PASS ${checks}');
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
