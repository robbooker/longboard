// #336 saved links and link reactions, database check on the full migration chain from the mobile
// fixture (synthetic in-memory data only): one copy per member per link; a copy outlives its
// original and is untouched by edits; removing a copy leaves the original; one reaction per member
// per emoji, with the chat's four choices; the summary's counts and names; the new table has RLS
// with no access for anon/authenticated; the rollback keeps copies as plain links, removes the
// column, table and function, changes no other function, and the migration re-applies cleanly.
// Usage: node scripts/tests/chat-page-link-saves-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-page-link-saves-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const member=async(person)=>{const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[person.name,person.id.at(-1).repeat(64)]);await db.query('insert into longboard_chat_members(id,user_id,display_name) values($1,$2,$3) on conflict do nothing',[guest.id,person.id,person.name]);return one('select id from longboard_chat_members where user_id=$1',[person.id]);};
const [alice,bob]=await Promise.all(people.slice(0,2).map(member));
let checks=0;const eq=(a,b,m=JSON.stringify(a)+' vs '+JSON.stringify(b))=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m='rejects')=>{await assert.rejects(p,re,m);checks++;};
const page=(await one(`select id from chat_pages where slug='trader-links'`)).id;
const addLink=async(url)=>(await one(`insert into chat_page_links(page_id,title,url,note,added_by) values($1,'Original',$2,'Note',$3) returning id`,[page,url,alice.id])).id;
const save=(who,link,url='https://a.com/')=>db.query(`insert into chat_private_links(member_id,title,url,saved_from_link_id) values($1,'Copy',$2,$3)`,[who.id,url,link]);
const copies=(who)=>db.query(`select title,url,saved_from_link_id from chat_private_links where member_id=$1 order by created_at`,[who.id]).then(r=>r.rows);
const functions=async()=>(await db.query(`select p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'chat_page_link_reaction_summary' order by 1,2`)).rows;

// 1. One copy per member per link; other people and typed-in links are unaffected.
const link=await addLink('https://a.com/');
await save(bob,link);
await rejects(save(bob,link,'https://other.com/'),/chat_private_links_one_save_per_link/,'even under a different address');
await save(alice,link);
eq((await copies(alice)).length,1,"another member's save is their own");
await db.query(`insert into chat_private_links(member_id,title,url) values($1,'Typed','https://t.com/'),($1,'Typed2','https://t2.com/')`,[bob.id]);
eq((await copies(bob)).length,3,'links with no original never collide');

// 2. Editing or removing the original leaves the copy.
await db.query(`update chat_page_links set title='Changed',url='https://changed.com/' where id=$1`,[link]);
eq((await copies(bob))[0],{title:'Copy',url:'https://a.com/',saved_from_link_id:link},'an edit never reaches the copy');
await db.query(`delete from chat_page_links where id=$1`,[link]);
eq((await copies(bob))[0],{title:'Copy',url:'https://a.com/',saved_from_link_id:null},'the copy outlives the original');

// 3. Removing a copy leaves the original, and it can be saved again.
const second=await addLink('https://b.com/');
await save(bob,second,'https://b.com/');
await db.query(`delete from chat_private_links where member_id=$1 and saved_from_link_id=$2`,[bob.id,second]);
eq((await one(`select count(*)::int n from chat_page_links where id=$1`,[second])).n,1,'the original is still there');
await save(bob,second,'https://b.com/');

// 4. Reactions: the chat's choices, one row per member per emoji, several emoji allowed, own link allowed.
const react=(who,l,emoji)=>db.query(`insert into chat_page_link_reactions(link_id,member_id,emoji) values($1,$2,$3)`,[l,who.id,emoji]);
for(const emoji of ['like','heart','laugh','rob'])await react(bob,second,emoji);
await rejects(react(bob,second,'fire'),/check/);
await rejects(react(bob,second,'heart'),/duplicate|unique|primary/i);
await react(alice,second,'heart');
const summary=(who,links)=>db.query(`select * from chat_page_link_reaction_summary($1,$2) order by emoji`,[who.id,links]).then(r=>r.rows);
const rows=await summary(alice,[second]);
eq(rows.find(r=>r.emoji==='heart'),{link_id:second,emoji:'heart',reaction_count:2,mine:true,names:['Alice','Bob'].filter(n=>people.some(p=>p.name===n))});
eq(rows.find(r=>r.emoji==='rob').mine,false,'mine is the asking member only');
eq((await summary(alice,[])).length,0,'no links, no rows');
await db.query(`delete from chat_page_link_reactions where link_id=$1 and member_id=$2 and emoji='heart'`,[second,bob.id]);
eq((await summary(bob,[second])).find(r=>r.emoji==='heart').reaction_count,1,'taking one back lowers the count');
const third=await addLink('https://c.com/');await react(alice,third,'laugh');
await db.query(`delete from chat_page_links where id=$1`,[third]);
eq((await one(`select count(*)::int n from chat_page_link_reactions where link_id=$1`,[third])).n,0,'removing a link removes its reactions');

// 5. Privacy.
eq((await one(`select relrowsecurity r from pg_class where relname='chat_page_link_reactions'`)).r,true,'RLS is on');
eq((await one(`select count(*)::int n from pg_policies where tablename='chat_page_link_reactions'`)).n,0,'and no policies');
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 await rejects(db.query(`select * from chat_page_link_reactions`),/permission denied/);
 await rejects(db.query(`select * from chat_page_link_reaction_summary('${alice.id}',array[]::uuid[])`),/permission denied/);
 await db.exec('reset role');
}

// 6. Rollback, then re-apply.
const rollback=await readFile(root+'supabase/rollbacks/20261030230000_chat_page_link_saves_reactions.down.sql','utf8');
const migration=await readFile(root+'supabase/migrations/20261030230000_chat_page_link_saves_reactions.sql','utf8');
const before=await functions();
const kept=(await copies(bob)).length;
await db.exec(rollback);
eq((await db.query(`select 1 from information_schema.columns where table_name='chat_private_links' and column_name='saved_from_link_id'`)).rows,[]);
eq((await db.query(`select 1 from information_schema.tables where table_name='chat_page_link_reactions'`)).rows,[]);
eq((await one(`select count(*)::int n from pg_proc where proname='chat_page_link_reaction_summary'`)).n,0);
eq((await db.query(`select title,url from chat_private_links where member_id=$1`,[bob.id])).rows.length,kept,'saved copies stay as plain links');
eq(await functions(),before,'no other function changed');
eq((await one(`select count(*)::int n from chat_page_links where id=$1`,[second])).n,1,'shared links stay');
await db.exec(migration+'\n-- again');
await save(bob,await addLink('https://d.com/'),'https://d.com/');
console.log(`PASS #336 saved links and link reactions database: ${checks} checks.`);
process.exit(0);
