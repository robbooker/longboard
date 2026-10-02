import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),owner='00000000-0000-4000-8000-000000000001',friend='00000000-0000-4000-8000-000000000002',worker='00000000-0000-4000-8000-000000000003';
let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
create table chat_accounts(id uuid primary key,longboard_user_id uuid);create table profiles(id uuid primary key,email text);
insert into chat_accounts values('${owner}','${owner}'),('${friend}',null);insert into profiles values('${owner}','madspreadsheets@gmail.com');`);
for(const file of ['20260916171034_private_chat_features.sql','20260916174554_chat_feature_notifications.sql','20260916210308_chat_feature_publish_approval.sql','20260917151325_chat_feature_archive.sql','20260917201156_chat_feature_priority.sql','20260917205526_chat_archive_declined.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.query("insert into chat_feature_members values($1,'participant')",[friend]);
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const create=async(n,status='done')=>db.query("insert into chat_feature_requests(id,title,created_by,status,created_at,priority,priority_set_at) values($1,$2,$3,$4,'2020-01-01',$5,'2030-01-01')",[id(n),`Ticket ${n} ${n%2?'needle':'other'}`,owner,status,n%4]);
const release=async(n,date,state='published')=>db.query("insert into chat_feature_releases(request_id,pr_number,head_sha,state,approved_by,approved_at,worker_token,claimed_at,merge_sha,deployment_id,updated_at) values($1,1,$2,$3,$4,now(),$5,now(),$2,'dpl_test',$6)",[id(n),'a'.repeat(40),state,owner,worker,date]);
for(let n=1;n<=120;n++){await create(n);await release(n,new Date(Date.UTC(2026,8,n)).toISOString());}
// The seven observed legacy rows each have duplicated per-recipient notifications.
for(let n=121;n<=127;n++){
 await create(n);await db.query("insert into chat_feature_notifications(account_id,request_id,event_key,category,label,request_title,created_at,read_at) values($1,$2,$3,'status','Published and verified','Legacy',$4,now()),($5,$2,$6,'status','Published and verified','Legacy',$7,null)",[owner,id(n),'status:'+n,`2026-08-${n-120} 10:00:00+00`,friend,'status:later'+n,`2026-08-${n-120} 11:00:00+00`]);
}
await create(128,'archived');await db.query("update chat_feature_requests set archived_at='2026-09-05 12:00:00+00' where id=$1",[id(128)]);
await create(129);await create(130,'archived');await create(131,'discussion');
await create(132);await release(132,'2026-12-01','failed');
await create(133);await release(133,'2030-01-01','failed');
await db.query("insert into chat_feature_notifications(account_id,request_id,event_key,category,label,request_title,created_at) values($1,$2,'status:legacy-with-failed-release','status','Published and verified','Legacy','2026-07-01 00:00:00+00')",[owner,id(133)]);
// A look-alike message and non-status notifications are never completion evidence.
await db.query("insert into chat_feature_messages(request_id,author_label,kind,body) values($1,'Rob','system','Published and verified October 2030')",[id(129)]);
await db.query("insert into chat_feature_notifications(account_id,request_id,event_key,category,label,request_title) values($1,$2,'message:fake','status','Published and verified','Fake'),($1,$2,'status:fake','replies','Published and verified','Fake'),($1,$2,'status:wrong','status','Ready to test','Fake')",[owner,id(129)]);
await db.query("update chat_feature_releases set updated_at='2026-09-10' where request_id in($1,$2)",[id(10),id(11)]);
// Later status evidence must not replace the published release timestamp.
await db.query("insert into chat_feature_notifications(account_id,request_id,event_key,category,label,request_title,created_at) values($1,$2,'status:late','status','Published and verified','Late','2035-01-01')",[owner,id(1)]);
const before=(await db.query("select (select jsonb_agg(r order by id) from chat_feature_requests r) requests,(select jsonb_agg(n order by id) from chat_feature_notifications n) notifications,(select jsonb_agg(l order by request_id) from chat_feature_releases l) releases")).rows[0];
const funcs=await db.query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in ('claim_chat_feature','archive_chat_feature','update_chat_feature_release','publish_chat_feature','approve_chat_feature_release') order by proname");
await db.exec(await readFile(new URL('../../supabase/migrations/20261002125758_chat_feature_archive_order.sql',import.meta.url),'utf8'));
equal((await db.query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in ('claim_chat_feature','archive_chat_feature','update_chat_feature_release','publish_chat_feature','approve_chat_feature_release') order by proname")).rows,funcs.rows);
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from chat_feature_request_list'),/permission denied/);checks++;await db.exec('reset role');}
await db.exec('set role service_role');
equal((await db.query("select has_table_privilege('service_role','chat_feature_request_list','SELECT') readable,has_table_privilege('service_role','chat_feature_request_list','INSERT,UPDATE,DELETE') writable")).rows[0],{readable:true,writable:false});
const read=async(n)=>(await db.query('select * from chat_feature_request_list where id=$1',[id(n)])).rows[0];
equal(new Date((await read(1)).archive_order_at).toISOString(),'2026-09-01T00:00:00.000Z');
for(let n=121;n<=127;n++)equal(new Date((await read(n)).archive_order_at).toISOString(),`2026-08-0${n-120}T10:00:00.000Z`);
equal(new Date((await read(128)).archive_order_at).toISOString(),'2026-09-05T12:00:00.000Z');
equal(new Date((await read(133)).archive_order_at).toISOString(),'2026-07-01T00:00:00.000Z');
for(const n of [129,130,131,132])equal((await read(n)).archive_order_at,null);
const fields=Object.keys(await read(1));for(const key of ['worker_token','approved_by','created_by','archived_by'])equal(fields.includes(key),false);
equal(Object.keys((await read(1)).release).sort(),['approved_at','head_sha','outcome','pr_number','state','version']);
for(const direction of ['asc','desc']){
 const all=(await db.query(`select id,archive_order_at from chat_feature_request_list where status in ('done','archived') order by archive_order_at ${direction} nulls last,id`)).rows;
 equal(all.length,132);equal(all.slice(-3).map(r=>r.id),[id(129),id(130),id(132)]);
 const pages=[];for(let page=0;page<3;page++)pages.push(...(await db.query(`select id,archive_order_at from chat_feature_request_list where status in ('done','archived') order by archive_order_at ${direction} nulls last,id limit 50 offset $1`,[page*50])).rows);
 equal(pages,all);equal(new Set(pages.map(r=>r.id)).size,132);
 const ties=all.filter(r=>[id(10),id(11)].includes(r.id));equal(ties.map(r=>r.id),[id(10),id(11)]);
 const filtered=(await db.query(`select id,archive_order_at from chat_feature_request_list where status in ('done','archived') and title ilike '%needle%' order by archive_order_at ${direction} nulls last,id`)).rows;
 equal(filtered,all.filter(r=>Number(r.id.slice(-12))%2===1));
}
await assert.rejects(()=>db.query("update chat_feature_request_list set title='Changed' where id=$1",[id(1)]),/permission denied|cannot update view/);checks++;
equal((await db.query("select (select jsonb_agg(r order by id) from chat_feature_requests r) requests,(select jsonb_agg(n order by id) from chat_feature_notifications n) notifications,(select jsonb_agg(l order by request_id) from chat_feature_releases l) releases")).rows[0],before);
const plan=(await db.query("explain (analyze,format json) select id from chat_feature_request_list where status in ('done','archived') order by archive_order_at desc nulls last,id limit 51")).rows[0]['QUERY PLAN'][0];
const scans=[];function inspect(node){if(node['Relation Name']==='chat_feature_notifications')scans.push(node);for(const child of node.Plans??[])inspect(child);}inspect(plan.Plan);equal(scans.length,1);equal(scans[0]['Actual Loops'],1);
await db.exec('reset role');equal((await db.query("select reloptions from pg_class where relname='chat_feature_request_list'")).rows[0].reloptions,['security_invoker=true']);
console.log(`PASS ${checks} archive projection assertions: authoritative release/manual/7 legacy dates, unknowns, global pages/search/ties, private safe fields, unchanged workflow definitions and zero read mutations; notification aggregate scans once.`);await db.close();
