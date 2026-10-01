import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',jammie='6ad10d99-fe91-4955-86fa-a893b9763573',other='00000000-0000-4000-8000-000000000003',outsider='00000000-0000-4000-8000-000000000004';
const migration='20260928120621_chat_jammie_development_approval.sql';
const apply=async file=>db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;
create table chat_accounts(id uuid primary key,longboard_user_id uuid);create table profiles(id uuid primary key,email text);
insert into chat_accounts values('${owner}','${owner}'),('${jammie}','${jammie}'),('${other}','${other}'),('${outsider}','${outsider}');
insert into profiles values('${owner}','madspreadsheets@gmail.com'),('${jammie}','ojammie@gmail.com'),('${other}','other@example.test'),('${outsider}','outsider@example.test');`);
for(const file of ['20260916171034_private_chat_features.sql','20260916174554_chat_feature_notifications.sql','20260916210308_chat_feature_publish_approval.sql','20260917151325_chat_feature_archive.sql','20260917201156_chat_feature_priority.sql','20260918134410_chat_edit_approved_request.sql'])await apply(file);
// Production has multiple participants; never infer identity from the role alone.
await db.exec('drop index chat_feature_one_participant');
await db.query("insert into chat_feature_members values($1,'participant')",[other]);
await apply(migration);
assert.deepEqual((await db.query('select account_id from chat_feature_members where can_approve_development')).rows,[{account_id:jammie}]);
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 await assert.rejects(()=>db.query("select chat_feature_action($1,null,'approve','',1)",[jammie]),/permission denied/);
 await assert.rejects(()=>db.query('update chat_feature_members set can_approve_development=true'),/permission denied/);
 await db.exec('reset role');
}
await db.exec('set role service_role');
const act=async(actor,id,action,content='',revision=0)=>(await db.query('select chat_feature_action($1,$2,$3,$4,$5) id',[actor,id,action,content,revision])).rows[0].id;
const proposal=async()=>{const id=await act(jammie,null,'create','Approval test');await act(jammie,id,'proposal','Exact approved scope.',1);return id;};
let id=await proposal();
await assert.rejects(()=>act(outsider,id,'approve','',2),/feature_access_denied/);
await assert.rejects(()=>act(other,id,'approve','',2),/development_approver_only/);
await assert.rejects(()=>act(jammie,id,'approve','',1),/proposal_changed_or_locked/);
await assert.rejects(()=>act(jammie,id,'decline','',2),/owner_only/);
await act(jammie,id,'approve','',2);
const row=(await db.query('select * from chat_feature_requests where id=$1',[id])).rows[0];
assert.equal(row.approved_by,jammie);assert.ok(row.approved_at);assert.equal(row.approved_proposal,'Exact approved scope.');assert.equal(row.status,'approved');
const audit=(await db.query("select * from chat_feature_messages where request_id=$1 and kind='system'",[id])).rows;
assert.equal(audit.length,1);assert.equal(audit[0].author_id,jammie);assert.equal(audit[0].author_label,'Jammie');assert.ok(audit[0].created_at);assert.match(audit[0].body,/Only Rob/);
assert.deepEqual((await db.query("select account_id from chat_feature_notifications where request_id=$1 and label='Approved for development' order by account_id",[id])).rows.map(r=>r.account_id),[owner,other]);
await assert.rejects(()=>act(jammie,id,'approve','',2),/proposal_changed_or_locked/);
await assert.rejects(()=>act(jammie,id,'proposal','Changed after approval',2),/proposal_changed_or_locked/);
for(const actor of [jammie,other]){
 await assert.rejects(()=>db.query('select approve_chat_feature_release($1,$2,1,$3)',[actor,id,'a'.repeat(40)]),/owner_only/);
 await assert.rejects(()=>db.query('select archive_chat_feature($1,$2,2)',[actor,id]),/owner_only/);
 await assert.rejects(()=>db.query("select edit_approved_chat_feature($1,$2,'Title','Scope',2)",[actor,id]),/owner_only/);
}
assert.equal((await db.query('select * from claim_chat_feature($1)',[outsider])).rows[0].id,id);
await db.query("select prepare_chat_feature_release($1,$2,999,$3,'Local authorization test')",[id,outsider,'a'.repeat(40)]);
for(const actor of [jammie,other])await assert.rejects(()=>db.query('select approve_chat_feature_release($1,$2,1,$3)',[actor,id,'a'.repeat(40)]),/owner_only/);
await db.query('select approve_chat_feature_release($1,$2,1,$3)',[owner,id,'a'.repeat(40)]);
assert.equal((await db.query('select approved_by from chat_feature_releases where request_id=$1',[id])).rows[0].approved_by,owner);
id=await proposal();await act(owner,id,'approve','',2);
assert.equal((await db.query('select approved_by from chat_feature_requests where id=$1',[id])).rows[0].approved_by,owner);
const empty=await act(jammie,null,'create','Empty');await assert.rejects(()=>act(jammie,empty,'approve','',1),/proposal_required/);
// Preferences and per-ticket mutes still suppress approval notifications.
id=await proposal();
await db.query('insert into chat_feature_notification_preferences(account_id,status) values($1,false)',[owner]);
await db.query('insert into chat_feature_notification_mutes(account_id,request_id) values($1,$2)',[other,id]);
await act(jammie,id,'approve','',2);
assert.equal((await db.query("select count(*)::int n from chat_feature_notifications where request_id=$1 and label='Approved for development'",[id])).rows[0].n,0);
// Removing the explicit capability fails closed on the next call.
await db.query('update chat_feature_members set can_approve_development=false where account_id=$1',[jammie]);
id=await proposal();await assert.rejects(()=>act(jammie,id,'approve','',2),/development_approver_only/);
// New members inherit no development authority.
await db.query("insert into chat_feature_members(account_id,role) values($1,'participant')",[outsider]);
await assert.rejects(()=>act(outsider,id,'approve','',2),/development_approver_only/);
await db.close();console.log('PASS Jammie development approval: exact identity/capability, actor/time/scope audit, notifications, stale/duplicate/empty refusal, revoked/new/other participants denied, owner-only release/archive/edit preserved.');
