// #529 Booker Tube database check, on the full migration chain from the mobile fixture
// (synthetic data; an in-memory database, never a real one):
//  - the four tables: RLS on, no policies, nothing for anon/authenticated, service role only;
//  - the seed: Rob's shared collection with 41 channels, 24 topics, 5 areas, 11 penalty phrases,
//    every channel's area and topics known to the collection, and no videos and no page row yet;
//  - store_chat_video_refresh: service role only, swaps the whole list, records the refresh,
//    refuses a bad list or an unknown collection and then leaves the old list untouched;
//  - Pages accepts the new kind once, still refuses unknown kinds, and links still can't be put on it;
//  - a member's own collection fits the same tables (one per member, removed with the member);
//  - the rollback removes everything and restores the old kind check, and the migration re-applies.
// Usage: node scripts/tests/chat-video-picks-database.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.slice(0,source.indexOf('function user(p)'))+`
export {db,people};`;
const target=new URL(`.chat-video-picks-db-${process.pid}.mjs`,import.meta.url);
await writeFile(target,source);
let db,people;try{({db,people}=await import(target.href));}finally{await unlink(target);}
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const all=async(sql,args=[])=>(await db.query(sql,args)).rows;
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const rejects=async(p,re,m)=>{await assert.rejects(p,re,m);checks++;};
const NAME='20261126130000_chat_video_picks';
const up=await readFile(`${root}supabase/migrations/${NAME}.sql`,'utf8');
const down=await readFile(`${root}supabase/rollbacks/${NAME}.down.sql`,'utf8');
const TABLES=['chat_video_collections','chat_video_channels','chat_video_topics','chat_video_picks'];
const FN='public.store_chat_video_refresh(uuid,jsonb,jsonb)';
const kindCheck=async()=>(await one(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.chat_pages'::regclass and conname='chat_pages_kind_check'`))?.d;

async function checkApplied(){
 for(const table of TABLES){
  eq((await one(`select relrowsecurity r from pg_class where oid=$1::regclass`,[table])).r,true,`${table} RLS`);
  eq(await all(`select 1 from pg_policies where tablename=$1`,[table]),[],`${table} no policies`);
  for(const role of ['anon','authenticated'])for(const right of ['select','insert','update','delete'])eq((await one(`select has_table_privilege($1,$2,$3) s`,[role,table,right])).s,false,`${table} ${role} ${right}`);
  for(const right of ['select','insert','update','delete'])eq((await one(`select has_table_privilege('service_role',$1,$2) s`,[table,right])).s,true,`${table} service ${right}`);
  eq((await one(`select has_table_privilege('service_role',$1,'truncate') s`,[table])).s,false,`${table} no truncate`);
 }
 for(const role of ['anon','authenticated','public'])eq((await one(`select has_function_privilege($1,$2,'execute') e`,[role,FN])).e,false,`${role} can't run the store function`);
 eq((await one(`select has_function_privilege('service_role',$1,'execute') e`,[FN])).e,true,'service role runs it');
 eq((await one(`select prosecdef d,proconfig c from pg_proc where oid=$1::regprocedure`,[FN])),{d:false,c:['search_path=""']},'security invoker, empty search path');
 // The seed.
 const c=await one(`select id,slug,title,visibility,owner_member_id,window_days,scoring,jsonb_array_length(areas) areas,jsonb_array_length(penalties) penalties,refreshed_at,refresh_stats from chat_video_collections`);
 eq({...c,id:undefined,scoring:undefined},{id:undefined,slug:'booker-tube',title:'Booker Tube',visibility:'members',owner_member_id:null,window_days:90,scoring:undefined,areas:5,penalties:11,refreshed_at:null,refresh_stats:null},'one shared collection, not refreshed yet');
 eq(c.scoring,{titleMultiplier:2.4,descriptionMultiplier:1,channelTopicPrior:3.5,recencyHalfLifeDays:30,recencyMaxBonus:3,minScoreToInclude:1},'scoring numbers');
 eq((await one(`select count(*)::int n,count(distinct channel_id)::int d from chat_video_channels where collection_id=$1`,[c.id])),{n:41,d:41},'41 channels');
 eq((await one(`select count(*)::int n,count(distinct area)::int a,sum(jsonb_array_length(keywords))::int k from chat_video_topics where collection_id=$1`,[c.id])),{n:24,a:5,k:(await one(`select sum(jsonb_array_length(keywords))::int k from chat_video_topics`)).k},'24 topics in 5 areas');
 assert((await one(`select sum(jsonb_array_length(keywords))::int k from chat_video_topics`)).k>200,'the topics carry their phrases');checks++;
 eq(await all(`select ch.channel_id from chat_video_channels ch where not exists(select 1 from chat_video_collections c,jsonb_array_elements(c.areas) a where c.id=ch.collection_id and a->>'id'=ch.area)
  or exists(select 1 from unnest(ch.topics) t where not exists(select 1 from chat_video_topics tp where tp.collection_id=ch.collection_id and tp.topic_id=t))`),[],'every channel area and topic is known');
 eq(await all(`select topic_id from chat_video_topics tp where not exists(select 1 from chat_video_collections c,jsonb_array_elements(c.areas) a where c.id=tp.collection_id and a->>'id'=tp.area)`),[],'every topic area is known');
 eq(await all(`select phrase from chat_video_collections c,jsonb_to_recordset(c.penalties) p(phrase text,penalty numeric) where p.penalty is null or p.penalty<=0 or p.phrase is null`),[],'penalties have a phrase and points');
 eq((await one(`select count(*)::int n from chat_video_picks`)).n,0,'no videos until the first refresh');
 eq((await one(`select count(*)::int n from chat_pages where kind='video-picks' or slug='booker-tube'`)).n,0,'no page row from the migration');
 eq(await kindCheck(),"CHECK ((kind = ANY (ARRAY['embed'::text, 'links'::text, 'my-links'::text, 'video-picks'::text])))",'kind check widened');
 eq((await one(`select count(*)::int n from pg_constraint where conrelid='public.chat_pages'::regclass and contype='c' and pg_get_constraintdef(oid) like '%my-links%'`)).n,1,'exactly one kind check');
 eq((await all(`select slug,kind from chat_pages where built_in order by position`)),[{slug:'market-dashboard',kind:'embed'},{slug:'trader-links',kind:'links'},{slug:'my-links',kind:'my-links'}],'existing pages untouched');
 return c.id;
}
const id=await checkApplied();

// The store function: the service role swaps the whole list in one step.
const video=(n,extra={})=>({id:`vid${String(n).padStart(8,'0')}`,channelId:'UCg3B_joekBGJ1s_4fRjsMKA',channel:'SMB Capital',title:`Video ${n}`,published:'2026-11-20T12:00:00.000Z',area:'trading',primaryTopic:'low-float-day-trading',topics:['low-float-day-trading','trading-psychology-flow'],snippet:'A line.',score:12.34,...extra});
const store=(collection,videos,stats={channels:41})=>db.query(`select public.store_chat_video_refresh($1,$2::jsonb,$3::jsonb) n`,[collection,videos===null?null:JSON.stringify(videos),JSON.stringify(stats)]);
await db.exec('set role service_role');
eq((await store(id,[video(1),video(2),video(3,{primaryTopic:null,topics:[],snippet:undefined})])).rows[0].n,3,'three stored');
eq(await all(`select video_id,channel_name,title,area,primary_topic,topics,snippet,score::float8 score,published_at from chat_video_picks order by video_id`),[
 {video_id:'vid00000001',channel_name:'SMB Capital',title:'Video 1',area:'trading',primary_topic:'low-float-day-trading',topics:['low-float-day-trading','trading-psychology-flow'],snippet:'A line.',score:12.34,published_at:new Date('2026-11-20T12:00:00Z')},
 {video_id:'vid00000002',channel_name:'SMB Capital',title:'Video 2',area:'trading',primary_topic:'low-float-day-trading',topics:['low-float-day-trading','trading-psychology-flow'],snippet:'A line.',score:12.34,published_at:new Date('2026-11-20T12:00:00Z')},
 {video_id:'vid00000003',channel_name:'SMB Capital',title:'Video 3',area:'trading',primary_topic:null,topics:[],snippet:'',score:12.34,published_at:new Date('2026-11-20T12:00:00Z')}],'rows as sent');
const first=await one(`select refreshed_at,refresh_stats from chat_video_collections where id=$1`,[id]);
assert(first.refreshed_at instanceof Date);checks++;eq(first.refresh_stats,{channels:41},'refresh recorded');
eq((await store(id,[video(2,{title:'Video 2 again'}),video(9)],{channels:40})).rows[0].n,2,'a second refresh');
eq(await all(`select video_id,title from chat_video_picks order by video_id`),[{video_id:'vid00000002',title:'Video 2 again'},{video_id:'vid00000009',title:'Video 9'}],'the old list is replaced, not added to');
// A bad list changes nothing: the same video twice, a bad id, a missing title, not a list at all.
await rejects(store(id,[video(4),video(4)]),/duplicate key/,'the same video twice');
await rejects(store(id,[video(5,{id:'not an id'})]),/violates check constraint/,'a bad video id');
await rejects(store(id,[video(6,{channelId:'nope'})]),/violates check constraint/,'a bad channel id');
await rejects(store(id,[video(7,{title:undefined})]),/null value/,'no title');
await rejects(store(id,[video(8,{score:-1})]),/violates check constraint/,'a negative score');
await rejects(store(id,{videos:[]}),/chat_video_videos_not_a_list/,'not a list');
await rejects(store(id,null),/chat_video_videos_not_a_list/,'null');
await rejects(store('99999999-9999-4999-8999-999999999999',[video(1)]),/chat_video_collection_not_found/,'unknown collection');
eq(await all(`select video_id from chat_video_picks order by video_id`),[{video_id:'vid00000002'},{video_id:'vid00000009'}],'refused lists leave the last good one');
eq((await one(`select refresh_stats from chat_video_collections where id=$1`,[id])).refresh_stats,{channels:40},'and the last good stats');
eq((await store(id,[],{channels:0})).rows[0].n,0,'an empty list is allowed (the app decides when to keep the old one)');
await store(id,[video(2),video(9)]);
// The app's own writes as the service role: a channel, and the page row.
await db.query(`insert into chat_video_channels(collection_id,channel_id,name,area) values($1,'UCaaaaaaaaaaaaaaaaaaaaaa','Added later','fun')`,[id]);
await rejects(db.query(`insert into chat_video_channels(collection_id,channel_id,name,area) values($1,'UCaaaaaaaaaaaaaaaaaaaaaa','Twice','fun')`,[id]),/duplicate key/,'a channel once per collection');
await rejects(db.query(`insert into chat_video_channels(collection_id,channel_id,name,area) values($1,'@handle','Bad','fun')`,[id]),/violates check constraint/,'only UC ids');
await db.query(`delete from chat_video_channels where collection_id=$1 and channel_id='UCaaaaaaaaaaaaaaaaaaaaaa'`,[id]);
await db.query(`insert into chat_pages(slug,name,kind,position,built_in) values('booker-tube','Booker Tube','video-picks',40,true) on conflict do nothing`);
await db.query(`insert into chat_pages(slug,name,kind,position,built_in) values('booker-tube','Booker Tube','video-picks',40,true) on conflict do nothing`);
eq((await one(`select count(*)::int n from chat_pages where kind='video-picks'`)).n,1,'the page row, once');
await rejects(db.query(`insert into chat_pages(slug,name,kind) values('more-picks','More','video-picks')`),/chat_pages_one_video_picks/,'one video page');
await rejects(db.query(`insert into chat_pages(slug,name,kind) values('odd','Odd','something-else')`),/chat_pages_kind_check/,'unknown kinds still refused');
await rejects(db.query(`insert into chat_pages(slug,name,kind,embed_url) values('odd','Odd','video-picks','https://example.test/')`),/chat_pages_embed_url/,'no embed address on it');
await rejects(db.query(`insert into chat_page_links(page_id,title,url) select id,'A link','https://example.test/' from chat_pages where kind='video-picks'`),/chat_page_not_a_list/,'links cannot be added to it');
await db.exec('reset role');
// Nobody else: a signed-in member and a visitor get nothing, even by name.
for(const role of ['authenticated','anon']){
 await db.exec(`set role ${role}`);
 for(const table of TABLES)await rejects(db.query(`select * from public.${table}`),/permission denied/,`${role} reads ${table}`);
 await rejects(store(id,[video(1)]),/permission denied/,`${role} runs the store function`);
 await db.exec('reset role');
}
// A member's own collection later: the same tables, one per member, gone with the member.
const bob=people[1].member.id;
const mine=(await one(`insert into chat_video_collections(slug,title,owner_member_id) values('bob-picks','Bob''s picks',$1) returning id,visibility`,[bob]));
eq(mine.visibility,'private','a member collection is private by default');
await rejects(db.query(`insert into chat_video_collections(slug,title,owner_member_id) values('bob-two','Second',$1)`,[bob]),/chat_video_collections_one_per_member/,'one per member');
await rejects(db.query(`insert into chat_video_collections(slug,title,visibility) values('nobody','Nobody''s','private')`),/chat_video_collections_shared_or_owned/,'an ownerless collection is the shared one');
await db.query(`insert into chat_video_channels(collection_id,channel_id,name,area,added_by) values($1,'UCg3B_joekBGJ1s_4fRjsMKA','SMB Capital','trading',$2)`,[mine.id,bob]);
await db.query(`insert into chat_video_topics(collection_id,topic_id,area,label) values($1,'tape','trading','Tape reading')`,[mine.id]);
await store(mine.id,[video(1)]);
eq((await one(`select count(*)::int n from chat_video_picks where collection_id=$1`,[id])).n,2,"Rob's list is not touched by another collection's refresh");
await db.query(`delete from chat_video_collections where id=$1`,[mine.id]);
eq((await one(`select (select count(*) from chat_video_channels where collection_id=$1)::int c,(select count(*) from chat_video_topics where collection_id=$1)::int t,(select count(*) from chat_video_picks where collection_id=$1)::int p`,[mine.id])),{c:0,t:0,p:0},'a collection takes its channels, topics and videos with it');

// Rollback, then the migration again.
await db.exec(down);
for(const table of TABLES)eq((await one(`select to_regclass($1) r`,[`public.${table}`])).r,null,`${table} gone`);
eq((await one(`select count(*)::int n from pg_proc where proname='store_chat_video_refresh'`)).n,0,'function gone');
eq((await one(`select count(*)::int n from chat_pages where kind='video-picks'`)).n,0,'page row gone');
eq(await kindCheck(),"CHECK ((kind = ANY (ARRAY['embed'::text, 'links'::text, 'my-links'::text])))",'kind check as before');
eq((await one(`select count(*)::int n from pg_indexes where indexname='chat_pages_one_video_picks'`)).n,0,'index gone');
eq((await one(`select count(*)::int n from chat_pages where built_in`)).n,3,'the other pages stay');
await db.exec(down);checks++; // running it twice is harmless
// The fixture runs a migration's exact text once; a trailing comment makes this a new run.
await db.exec(up+'\n-- applied again after the rollback\n');
await checkApplied();
console.log(`chat-video-picks-database: ${checks} checks passed`);
process.exit(0);
