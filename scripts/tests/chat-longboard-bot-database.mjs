// #413 Longboard Bot database check on the full migration chain from the mobile fixture (synthetic data):
// the actor check allows bot 'longboard' in every room and never with a member or guest; the posting
// function posts once per id in every room "all" covers, refuses Gainers, respects a paused room, and
// is service-role only; the other bots' guards still hold; the rollback restores the previous
// definitions and the migration re-applies cleanly.
// Usage: node scripts/tests/chat-longboard-bot-database.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
// #443 redefines the announcement writer and the What's New guard after this; hold it back so the
// rollback/re-apply checks compare this migration's own definitions.
process.env.CHAT_FIXTURE_DEFER_MIGRATIONS=[process.env.CHAT_FIXTURE_DEFER_MIGRATIONS,'20261111143000_chat_whats_new_pictures.sql'].filter(Boolean).join(',');
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-longboard-bot-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const up=await readFile(`${root}supabase/migrations/20261110200000_chat_longboard_bot.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/20261110200000_chat_longboard_bot.down.sql`,'utf8');
const whatsNew=await readFile(`${root}supabase/migrations/20261023200000_chat_whats_new_room.sql`,'utf8');
const club=await readFile(`${root}supabase/migrations/20261109120000_chat_stock_club.sql`,'utf8');
// The fixture skips SQL it already ran once; a marker makes a re-run real.
let runs=0;const run=sql=>db.exec(`${sql}\n-- run ${++runs}`);

const ROOMS=(await db.query(`select room_slug from longboard_chat_room_state order by id`)).rows.map(r=>r.room_slug);
eq(ROOMS.length,14,'fourteen rooms');
const ALL=ROOMS.filter(r=>r!=='gainers');
const PROD_ACTOR=`CHECK ((((guest_id IS NOT NULL) AND (bot_slug IS NULL)) OR ((guest_id IS NULL) AND (bot_slug = 'buddy'::text)) OR ((room_slug = 'gainers'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'gainers'::text)) OR ((room_slug = 'whats-new'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'whats-new'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = ANY (ARRAY['faq-suggestions'::text, 'chat-improvements'::text]))) OR ((room_slug = 'club'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'club'::text)) OR ((room_slug = ANY (ARRAY['runner-watch'::text, 'main'::text, 'shortscout'::text])) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch'::text)) OR ((room_slug = 'admins'::text) AND (guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'runner-watch-notices'::text))))`;
const actorDef=async()=>(await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='longboard_chat_messages_actor_check'`)).d;
const FNS=['enforce_chat_announcement_writer','enforce_chat_whats_new_note','enforce_chat_club_post'];
const fnDef=async name=>(await one(`select pg_get_functiondef($1::regproc) d`,[`public.${name}`])).d;

// The fixture's chain already includes this migration.
eq(await actorDef(),PROD_ACTOR.slice(0,-2)+` OR ((guest_id IS NULL) AND (member_id IS NULL) AND (bot_slug = 'longboard'::text))))`,'actor check: production plus one clause');

// The actor check alone (the room guards switched off inside a rolled-back transaction): every room.
const raw=(room,extra='',vals='')=>db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug${extra}) values($1,'Longboard Bot','probe','longboard'${vals}) returning id`,[room]);
await db.exec('begin');
await db.exec(`alter table longboard_chat_messages disable trigger chat_gainers_source_guard;alter table longboard_chat_messages disable trigger chat_club_post_guard;alter table longboard_chat_messages disable trigger chat_whats_new_note_guard;alter table longboard_chat_messages disable trigger announcement_message_writer`);
for(const room of ROOMS){await raw(room);checks++;}
await db.exec('rollback');
// Never with a member or a guest, in any room.
const member=await one('select id from longboard_chat_members where user_id=$1',[people[1].id]);
for(const room of ROOMS){
 await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,member_id) values($1,'Longboard Bot','probe','longboard',$2)`,[room,member.id]),/actor_check|_read_only|_forbidden|admin_only/,`member_id refused in ${room}`);
 await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,guest_id,member_id) values($1,'Longboard Bot','probe','longboard',$2,$2)`,[room,member.id]),/actor_check|_read_only|_forbidden|admin_only/,`guest_id refused in ${room}`);
}
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug,guest_id,member_id) values('main','Longboard Bot','probe','longboard',$1,$1)`,[member.id]),/actor_check/,'main: the actor check itself');

// Posting.
const post=(id,room,body='Profile pictures are here.')=>one(`select public.post_chat_longboard_announcement($1,$2,$3) r`,[id,room,body]).then(r=>r.r);
const count=async room=>(await one(`select count(*)::int n from longboard_chat_messages where room_slug=$1 and bot_slug='longboard'`,[room])).n;
const head=async room=>Number((await one(`select coalesce((select seq from longboard_chat_room_event_heads where room_slug=$1),0) s`,[room])).s);
const ids=Object.fromEntries(ALL.map(r=>[r,randomUUID()]));
const mentionsBefore=(await one(`select count(*)::int n from chat_room_mentions where room_slug='lb-announcements'`)).n;
for(const room of ALL){
 const before=await head(room);
 const r=await post(ids[room],room);
 eq(r,{posted:true,messageId:ids[room]},`posts in ${room}`);
 eq(await count(room),1,`one post in ${room}`);
 assert.ok(await head(room)>before,`${room}: a room event`);checks++;
}
eq(await one(`select author_label,body,bot_slug,member_id,guest_id,client_id::text from longboard_chat_messages where id=$1`,[ids.main]),{author_label:'Longboard Bot',body:'Profile pictures are here.',bot_slug:'longboard',member_id:null,guest_id:null,client_id:ids.main},'as the bot');
assert.ok((await one(`select count(*)::int n from chat_room_mentions where room_slug='lb-announcements'`)).n>mentionsBefore,'announcement room: reaches the bell like an admin announcement');checks++;
eq((await one(`select count(*)::int n from chat_room_mentions where message_id=$1`,[ids.main])).n,0,'main: tags nobody');
// A retry posts nothing and stamps no event.
for(const room of ALL){
 const before=await head(room);
 eq(await post(ids[room],room),{posted:false,reason:'duplicate',messageId:ids[room]},`retry in ${room}`);
 eq([await count(room),await head(room)],[1,before],`${room}: still one post, no event`);
}
await rejects(post(ids.main,'social'),/announcement_id_taken/,'an id from another room');
const memberMessage=await one(`select id from longboard_chat_messages where bot_slug is null limit 1`);
await rejects(post(memberMessage.id,'main'),/announcement_id_taken/,'a member message id');
// Gainers stays a stock-alert feed.
await rejects(post(randomUUID(),'gainers'),/gainers_read_only/,'gainers refused');
// Body rules.
await rejects(post(randomUUID(),'main','   '),/invalid_announcement/,'empty');
await rejects(post(randomUUID(),'main','x'.repeat(4001)),/invalid_announcement/,'too long');
eq((await post(randomUUID(),'main','x'.repeat(4000))).posted,true,'4000 characters');
// A paused room.
await db.query(`update longboard_chat_room_state set is_open=false,paused_at=now(),paused_by=$1 where room_slug='social'`,[people[0].id]);
await rejects(post(randomUUID(),'social'),/longboard_chat_paused/,'paused room');
await db.query(`update longboard_chat_room_state set is_open=true,paused_at=null,paused_by=null where room_slug='social'`);
// Members can reply in a conversation room, not in club or What's New.
await db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'main','Bob','Nice',$2)`,[member.id,ids.main]);checks++;
await rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'club','Bob','Nice',$2)`,[member.id,ids.club]),/club_read_only|chat_room_forbidden/,'no replies in club');
await rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body,reply_to_id) values($1,$1,'whats-new','Bob','Nice',$2)`,[member.id,ids['whats-new']]),/whats_new_no_replies|admin_only/,'no replies in What\'s New');
// The other bots' guards still hold.
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('whats-new','Booker Chat Updates','x','whats-new')`),/whats_new_note_forbidden/,'whats-new note without a ledger row');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('club','Booker Stock Club','x','club')`),/club_read_only/,'club post without a pick');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('club','Someone','x','longboard')`),/club_read_only/,'club: only as Longboard Bot');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('whats-new','Someone','x','longboard')`),/whats_new_note_forbidden/,'whats-new: only as Longboard Bot');
await rejects(db.query(`insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'lb-announcements','Bob','x')`,[member.id]),/announcement_admin_only/,'members still can\'t announce');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('lb-announcements','X','x','runner-watch')`),/actor_check|admin_only/,'other bots still can\'t announce');
await rejects(db.query(`update longboard_chat_messages set body='changed' where id=$1`,[ids.club]),/club_read_only/,'club posts stay as posted');
// Service role only.
for(const role of ['anon','authenticated'])eq((await one(`select has_function_privilege($1,'public.post_chat_longboard_announcement(uuid,text,text)','execute') e`,[role])).e,false,`${role} can't post`);
eq((await one(`select has_function_privilege('service_role','public.post_chat_longboard_announcement(uuid,text,text)','execute') e`)).e,true,'service role can');

// Rollback: the previous definitions, then the migration again.
const after={};for(const name of FNS)after[name]=await fnDef(name);
await run(down);
eq(await actorDef(),PROD_ACTOR,'rollback: production actor check');
eq((await one(`select to_regprocedure('public.post_chat_longboard_announcement(uuid,text,text)') f`)).f,null,'rollback: function gone');
eq(await count('main'),0,'rollback: bot posts gone');
const body=(sql,name)=>{const at=sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`,'i'));assert.ok(at>=0,name);const rest=sql.slice(at);const open=rest.match(/\$(function)?\$/);const start=open.index+open[0].length;return rest.slice(start,rest.indexOf(open[0],start)).trim();};
const lastDef=(sql,name)=>{const all=[...sql.matchAll(new RegExp(`create (or replace )?function public\\.${name}\\(`,'gi'))];return body(sql.slice(all.at(-1).index),name);};
eq(body(down,'enforce_chat_announcement_writer'),lastDef(whatsNew,'enforce_chat_announcement_writer'),'rollback: announcement writer as before');
eq(body(down,'enforce_chat_whats_new_note'),lastDef(whatsNew,'enforce_chat_whats_new_note'),'rollback: What\'s New guard as before');
eq(body(down,'enforce_chat_club_post'),lastDef(club,'enforce_chat_club_post'),'rollback: club guard as before');
for(const name of FNS){const live=await fnDef(name);assert.ok(live.includes(body(down,name)),`rollback live: ${name}`);checks++;}
await rejects(post(randomUUID(),'main'),/does not exist/,'rollback: nothing posts');
await rejects(db.query(`insert into longboard_chat_messages(room_slug,author_label,body,bot_slug) values('main','Longboard Bot','x','longboard')`),/actor_check/,'rollback: the bot is refused');
await run(up);
for(const name of FNS)eq(await fnDef(name),after[name],`re-applied: ${name}`);
eq((await post(randomUUID(),'main')).posted,true,'re-applied: posts');

console.log(`chat-longboard-bot-database: ${checks} checks passed`);
process.exit(0);
