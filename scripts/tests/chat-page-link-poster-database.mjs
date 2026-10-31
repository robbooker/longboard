// #339 the original poster on a saved link, database check on the full migration chain from the
// mobile fixture (synthetic in-memory data only): a save takes the original's poster and a request
// can't set another; typed-in links have none; title edits keep it; a new address clears it; it
// outlives the original; removing the poster clears it and keeps the copy; existing copies are
// filled in by the migration; the rollback removes only what the migration added and it re-applies.
// Usage: node scripts/tests/chat-page-link-poster-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-page-link-poster-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const member=async(person)=>{const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[person.name,person.id.at(-1).repeat(64)]);await db.query('insert into longboard_chat_members(id,user_id,display_name) values($1,$2,$3) on conflict do nothing',[guest.id,person.id,person.name]);return one('select id from longboard_chat_members where user_id=$1',[person.id]);};
const [alice,bob,mallory]=await Promise.all(people.slice(0,3).map(member));
let checks=0;const eq=(a,b,m=JSON.stringify(a)+' vs '+JSON.stringify(b))=>{assert.deepEqual(a,b,m);checks++;};
const page=(await one(`select id from chat_pages where slug='trader-links'`)).id;
const post=async(url,by=alice)=>(await one(`insert into chat_page_links(page_id,title,url,added_by) values($1,'Original',$2,$3) returning id`,[page,url,by.id])).id;
const save=async(who,link,url)=>(await one(`insert into chat_private_links(member_id,title,url,saved_from_link_id) values($1,'Copy',$2,$3) returning id,saved_from_member_id`,[who.id,url,link]));
const poster=async(id)=>(await one(`select saved_from_member_id p from chat_private_links where id=$1`,[id])).p;

// 1. A save takes the original's poster, whoever saves it; typed-in links have none.
const a=await post('https://a.com/');
const bobCopy=await save(bob,a,'https://a.com/'),malloryCopy=await save(mallory,a,'https://a.com/');
eq(bobCopy.saved_from_member_id,alice.id);
eq(malloryCopy.saved_from_member_id,alice.id,'the same for another saver');
eq((await save(alice,await post('https://own.com/'),'https://own.com/')).saved_from_member_id,alice.id,'saving your own post names you');
eq((await save(bob,null,'https://typed.com/')).saved_from_member_id,null,'typed-in links name no one');
eq((await one(`insert into chat_private_links(member_id,title,url,saved_from_member_id) values($1,'Forged','https://forged.com/',$2) returning saved_from_member_id s`,[bob.id,alice.id])).s,null,'a typed-in link cannot claim a poster');
eq((await one(`insert into chat_private_links(member_id,title,url,saved_from_link_id,saved_from_member_id) values($1,'Forged','https://a2.com/',$2,$1) returning saved_from_member_id s`,[mallory.id,await post('https://a2.com/')])).s,alice.id,'a save cannot claim another poster');

// 2. Edits: title and note keep it, the same address keeps it, a new address clears it.
await db.query(`update chat_private_links set title='Mine',note='Note',url='https://a.com/' where id=$1`,[bobCopy.id]);
eq(await poster(bobCopy.id),alice.id,'a title edit keeps it');
await db.query(`update chat_private_links set url='https://elsewhere.com/' where id=$1`,[malloryCopy.id]);
eq(await poster(malloryCopy.id),null,'a new address clears it');
await db.query(`update chat_private_links set url='https://a.com/' where id=$1`,[malloryCopy.id]);
eq(await poster(malloryCopy.id),null,'and changing back does not bring it back');

// 3. The original goes: the copy keeps its poster. An edit to the original doesn't change it.
const b=await post('https://b.com/');
const bCopy=await save(bob,b,'https://b.com/');
await db.query(`update chat_page_links set title='Changed' where id=$1`,[b]);
eq(await poster(bCopy.id),alice.id);
await db.query(`delete from chat_page_links where id=$1`,[b]);
eq(await one(`select saved_from_link_id l,saved_from_member_id p from chat_private_links where id=$1`,[bCopy.id]),{l:null,p:alice.id},'it outlives the original');

// 4. Removing the poster clears the name and keeps the copy; a saver's own removal removes theirs.
const leaverUser=(await one(`select gen_random_uuid() id`)).id;
await db.query('insert into auth.users values($1)',[leaverUser]);
await db.query("insert into profiles values($1,'leaver@example.test','user')",[leaverUser]);
const c=(await one(`select longboard_chat_link_member($1,'Leaver',null) m`,[leaverUser])).m;
const cCopy=await save(bob,await post('https://c.com/',c),'https://c.com/');
eq(cCopy.saved_from_member_id,c.id);
await db.query('delete from longboard_chat_members where id=$1',[c.id]);
eq(await one(`select url,saved_from_member_id p from chat_private_links where id=$1`,[cCopy.id]),{url:'https://c.com/',p:null},'the copy stays, unnamed');

// 5. Rollback; copies saved before the column existed; re-apply fills them in.
const rollback=await readFile(root+'supabase/rollbacks/20261031090000_chat_private_link_poster.down.sql','utf8');
const migration=await readFile(root+'supabase/migrations/20261031090000_chat_private_link_poster.sql','utf8');
const functions=async()=>(await db.query(`select p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'chat_private_link_set_poster' order by 1,2`)).rows;
const before=await functions();
const total=(await one('select count(*)::int n from chat_private_links')).n;
await db.exec(rollback);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_private_links' and column_name='saved_from_member_id'`)).rows,[]);
eq((await one(`select count(*)::int n from pg_proc where proname='chat_private_link_set_poster'`)).n,0);
eq((await one('select count(*)::int n from chat_private_links')).n,total,'every saved link stays');
eq(await functions(),before,'no other function changed');
const d=await post('https://d.com/');
const old=(await one(`insert into chat_private_links(member_id,title,url,saved_from_link_id) values($1,'Older',$2,$3) returning id,updated_at`,[bob.id,'https://d.com/',d]));
await db.query(`update chat_private_links set updated_at='2026-01-01' where id=$1`,[old.id]);
const orphan=(await one(`insert into chat_private_links(member_id,title,url,saved_from_link_id) values($1,'Older gone',$2,$3) returning id`,[bob.id,'https://e.com/',await post('https://e.com/')])).id;
await db.query(`delete from chat_page_links where url='https://e.com/'`);
await db.exec(migration+'\n-- again');
eq(await poster(old.id),alice.id,'an older copy gets its poster');
eq((await one(`select updated_at::date::text d from chat_private_links where id=$1`,[old.id])).d,'2026-01-01','without looking edited');
eq(await poster(orphan),null,'an older copy whose original is gone stays unnamed');
eq(await poster(bobCopy.id),alice.id,'copies still tied to their original get it back');
eq((await save(bob,await post('https://f.com/'),'https://f.com/')).saved_from_member_id,alice.id,'saving works after re-applying');
console.log(`PASS #339 original poster on saved links database: ${checks} checks.`);
process.exit(0);
