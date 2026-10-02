import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),owner='00000000-0000-4000-8000-000000000001',creator='00000000-0000-4000-8000-000000000002',outsider='00000000-0000-4000-8000-000000000003';
let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;},reject=async(fn,pattern=/ticket_not_deletable/)=>{await assert.rejects(fn,pattern);checks++;};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
create table chat_accounts(id uuid primary key,longboard_user_id uuid);create table profiles(id uuid primary key,email text);
insert into chat_accounts values('${owner}','${owner}'),('${creator}',null),('${outsider}',null);insert into profiles values('${owner}','madspreadsheets@gmail.com');`);
for(const file of ['20260916171034_private_chat_features.sql','20260916174554_chat_feature_notifications.sql','20260916210308_chat_feature_publish_approval.sql','20260917151325_chat_feature_archive.sql','20260917201156_chat_feature_priority.sql','20260917205526_chat_archive_declined.sql','20260918134410_chat_edit_approved_request.sql','20260928120621_chat_jammie_development_approval.sql','20261002125758_chat_feature_archive_order.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.query("insert into chat_feature_members(account_id,role,can_approve_development) values($1,'participant',true)",[creator]);
const protectedFunctions=()=>db.query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in ('chat_feature_action','claim_chat_feature','archive_chat_feature','edit_approved_chat_feature','prepare_chat_feature_release','approve_chat_feature_release','update_chat_feature_release') order by proname");
const before=(await protectedFunctions()).rows;
await db.exec(await readFile(new URL('../../supabase/migrations/20261002150404_chat_ticket_delete.sql',import.meta.url),'utf8'));
equal((await protectedFunctions()).rows,before);
const create=async(actor=creator,status='discussion')=>(await db.query("insert into chat_feature_requests(title,proposal,created_by,status) values('Delete fixture','Saved proposed scope',$1,$2) returning id",[actor,status])).rows[0].id;
const allowed=async(id,actor=creator,revision=1)=>(await db.query('select can_delete_chat_feature($1,$2,$3) value',[actor,id,revision])).rows[0].value;
const remove=(id,actor=creator,revision=1)=>db.query('select delete_chat_feature($1,$2,$3) value',[actor,id,revision]);
const count=async(table,id)=>(await db.query(`select count(*)::int n from ${table} where ${table==='chat_feature_requests'?'id':'request_id'}=$1`,[id])).rows[0].n;
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await reject(()=>allowed(owner),/permission denied/);await reject(()=>remove(owner),/permission denied/);await db.exec('reset role');}
const definitions=(await db.query("select prosecdef,proconfig from pg_proc where proname in ('can_delete_chat_feature','delete_chat_feature')")).rows;
equal(definitions.length,2);for(const row of definitions){equal(row.prosecdef,false);equal(row.proconfig,['search_path=""']);}
await db.exec('set role service_role');
const own=await create(),unrelated=await create();
equal(await allowed(own),true);equal(await allowed(own,owner),false);equal(await allowed(own,outsider),false);
for(const actor of [owner,outsider,null])await reject(()=>remove(own,actor));
for(const revision of [0,null,2]){equal(await allowed(own,creator,revision),false);await reject(()=>remove(own,creator,revision));}
await db.query("insert into chat_feature_messages(request_id,author_id,author_label,body) values($1,$2,'Creator','Delete only this discussion'),($3,$2,'Creator','Keep unrelated discussion')",[own,creator,unrelated]);
await db.query('insert into chat_feature_notification_mutes(account_id,request_id) values($1,$2),($1,$3)',[creator,own,unrelated]);
const unrelatedBefore=(await db.query('select to_jsonb(r) value from chat_feature_requests r where id=$1',[unrelated])).rows[0].value;
const ownBefore=(await db.query('select to_jsonb(r) value from chat_feature_requests r where id=$1',[own])).rows[0].value;
equal(await allowed(own),true);equal((await db.query('select to_jsonb(r) value from chat_feature_requests r where id=$1',[own])).rows[0].value,ownBefore);
equal((await remove(own)).rows[0].value,own);
for(const table of ['chat_feature_requests','chat_feature_messages','chat_feature_notifications','chat_feature_notification_mutes'])equal(await count(table,own),0);
equal((await db.query('select to_jsonb(r) value from chat_feature_requests r where id=$1',[unrelated])).rows[0].value,unrelatedBefore);
equal(await count('chat_feature_messages',unrelated),1);equal(await count('chat_feature_notification_mutes',unrelated),1);equal((await db.query('select count(*)::int n from chat_feature_notifications where request_id=$1',[unrelated])).rows[0].n>0,true);
await reject(()=>remove(own));
// The owner can delete their own draft, but never has an override for another creator.
const owners=await create(owner);equal(await allowed(owners,owner),true);await remove(owners,owner);equal(await count('chat_feature_requests',owners),0);
for(const status of ['approved','in_progress','ready','declined','blocked','done','archived']){const id=await create(creator,status);equal(await allowed(id),false);await reject(()=>remove(id));equal(await count('chat_feature_requests',id),1);}
for(const [column,value]of [['approved_by',owner],['approved_at',new Date().toISOString()],['approved_proposal','Prior scope'],['claimed_at',new Date().toISOString()],['worker_token',outsider],['archived_at',new Date().toISOString()],['archived_by',owner],['outcome','Prior work']]){const id=await create();await db.query(`update chat_feature_requests set ${column}=$1 where id=$2`,[value,id]);equal(await allowed(id),false);await reject(()=>remove(id));}
for(const state of ['ready','approved','publishing','failed','published']){const id=await create();await db.query("insert into chat_feature_releases(request_id,pr_number,head_sha,state,approved_by,approved_at,worker_token,claimed_at,merge_sha,deployment_id) values($1,1,$2,$3,$4,now(),$4,now(),$2,'dpl_test')",[id,'a'.repeat(40),state,owner]);equal(await allowed(id),false);await reject(()=>remove(id));equal(await count('chat_feature_releases',id),1);}
// Actual earlier/later orderings on the shared request lock (sequential, not multi-session).
const edited=await create();await db.query("select chat_feature_action($1,$2,'proposal','Changed scope',1)",[creator,edited]);await reject(()=>remove(edited));equal(await allowed(edited,creator,2),true);await remove(edited,creator,2);
const approved=await create();await db.query("select chat_feature_action($1,$2,'approve','',1)",[owner,approved]);await reject(()=>remove(approved));
const archived=await create();await db.query('select archive_chat_feature($1,$2,1)',[owner,archived]);await reject(()=>remove(archived));
const removed=await create();await remove(removed);for(const action of ['proposal','approve'])await reject(()=>db.query('select chat_feature_action($1,$2,$3,$4,1)',[owner,removed,action,'Scope']),/request_not_found/);await reject(()=>db.query('select archive_chat_feature($1,$2,1)',[owner,removed]),/request_not_found/);
const revoked=await create();await db.query('delete from chat_feature_members where account_id=$1',[creator]);equal(await allowed(revoked),false);await reject(()=>remove(revoked));
equal((await protectedFunctions()).rows,before);
console.log(`PASS ${checks} ticket deletion assertions: creator/current membership, all lifecycle/history exclusions, revision ordering, actual approval/edit/archive orderings, scoped cascade/privacy and unchanged publisher functions. Sequential PGlite; no multi-session concurrency claim.`);await db.close();
