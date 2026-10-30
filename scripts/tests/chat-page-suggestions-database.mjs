// #329 page suggestions database check on the full migration chain from the mobile fixture
// (synthetic in-memory data only): existing pages stay approved; a built-in page can't be anything
// else; a member can have 3 pages waiting, a 4th is refused, a decided one frees a slot, and admins'
// pages don't count; links can only go on an approved list; the rollback restores the link trigger's
// exact #321 body, removes the columns and deletes suggestions (so none surface), keeps approved
// pages, and the migration re-applies cleanly.
// Usage: node scripts/tests/chat-page-suggestions-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-page-suggestions-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
// Chat members, as the routes see them.
const member=async(person)=>{const guest=await one('insert into longboard_chat_guests(display_name,token_hash) values($1,$2) returning id',[person.name,person.id.at(-1).repeat(64)]);await db.query('insert into longboard_chat_members(id,user_id,display_name) values($1,$2,$3) on conflict do nothing',[guest.id,person.id,person.name]);return one('select id from longboard_chat_members where user_id=$1',[person.id]);};
const [alice,bob,mallory]=await Promise.all(people.map(member));
let checks=0;const eq=(a,b,m=JSON.stringify(a)+' vs '+JSON.stringify(b))=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m='rejects')=>{await assert.rejects(p,re,m);checks++;};
const suggest=(by,name)=>one(`insert into chat_pages(slug,name,kind,status,suggested_by,created_by) values($1,$2,'links','pending',$3,$3) returning id`,[name.toLowerCase().replace(/\W/g,'-')+'-x',name,by.id]);
const addLink=(page)=>db.query(`insert into chat_page_links(page_id,title,url) values($1,'T','https://a.com/')`,[page]);
const body=async()=>(await one(`select prosrc from pg_proc where proname='enforce_chat_page_link_page'`)).prosrc;

// 1. Existing rows and defaults.
eq((await db.query(`select distinct status from chat_pages`)).rows,[{status:'approved'}]);
const plain=await one(`insert into chat_pages(slug,name,kind,created_by) values('admin-page','Admin Page','links',$1) returning id,status`,[alice.id]);
eq(plain.status,'approved','a page with no status is live at once');
await rejects(db.query(`update chat_pages set status='pending' where slug='trader-links'`),/chat_pages_built_in_approved/);
await rejects(db.query(`insert into chat_pages(slug,name,kind,status) values('bad-status','X','links','maybe')`),/chat_pages_status/);

// 2. The limit: 3 waiting per member.
const first=await suggest(bob,'One');await suggest(bob,'Two');const third=await suggest(bob,'Three');
await rejects(suggest(bob,'Four'),/chat_page_suggestion_limit/);
await suggest(mallory,'Hers');
eq(Number((await one(`select count(*) n from chat_pages where suggested_by=$1 and status='pending'`,[bob.id])).n),3,"one member's limit is theirs alone");
await db.query(`update chat_pages set status='declined',decided_by=$1,decided_at=now() where id=$2`,[alice.id,third.id]);
await suggest(bob,'Four');
await db.query(`insert into chat_pages(slug,name,kind,created_by) values('admin-more','More','links',$1)`,[bob.id]);

// 3. Links go only on approved lists.
await rejects(addLink(first.id),/chat_page_not_a_list/);
await rejects(addLink(third.id),/chat_page_not_a_list/);
await db.query(`update chat_pages set status='approved',decided_by=$1,decided_at=now() where id=$2`,[alice.id,first.id]);
await addLink(first.id);
eq((await one(`select status,decided_by,suggested_by from chat_pages where id=$1`,[first.id])),{status:'approved',decided_by:alice.id,suggested_by:bob.id});
eq((await one(`select count(*)::int n from chat_page_links where page_id=$1`,[first.id])).n,1);
const applied=await body();

// 4. Rollback.
const original=(await readFile(root+'supabase/migrations/20261029120000_chat_pages.sql','utf8')).match(/create function public\.enforce_chat_page_link_page\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)[1];
const rollback=await readFile(root+'supabase/rollbacks/20261030180000_chat_page_suggestions.down.sql','utf8');
const migration=await readFile(root+'supabase/migrations/20261030180000_chat_page_suggestions.sql','utf8');
await db.exec(rollback);
eq(await body(),original,'the link trigger is back to its exact #321 body');
eq((await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='chat_pages' and column_name in ('status','suggested_by','decided_by','decided_at')`)).rows,[]);
eq((await one(`select count(*)::int n from pg_proc where proname='enforce_chat_page_suggestion_limit'`)).n,0);
eq((await db.query(`select name from chat_pages where name in ('Two','Three','Four','Hers')`)).rows,[],'no suggestion surfaces after a rollback');
eq((await db.query(`select name from chat_pages where name in ('One','Admin Page') order by name`)).rows,[{name:'Admin Page'},{name:'One'}],'approved pages stay');
eq((await one(`select count(*)::int n from chat_page_links where page_id=$1`,[first.id])).n,1,'with their links');
await db.exec(migration+'\n-- again');
eq(await body(),applied,'the migration re-applies cleanly');
eq((await one(`select status from chat_pages where id=$1`,[first.id])).status,'approved');
console.log(`PASS #329 page suggestions database (${checks} checks)`);
process.exit(0);
