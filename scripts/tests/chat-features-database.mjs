import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='00000000-0000-4000-8000-000000000001',friend='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;
create table chat_accounts(id uuid primary key,longboard_user_id uuid);create table profiles(id uuid primary key,email text);
insert into chat_accounts values('${owner}','${owner}'),('${friend}',null),('${other}',null);
insert into profiles values('${owner}','madspreadsheets@gmail.com');`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260916171034_private_chat_features.sql',import.meta.url),'utf8'));
await db.query("insert into chat_feature_members values($1,'participant')",[friend]);
await db.exec(`create table longboard_chat_members(user_id uuid,display_name text);grant select on longboard_chat_members to service_role;insert into longboard_chat_members values('${friend}','Jammie'),('${other}','Liz Pinon');`);
await db.exec(await readFile(new URL('../../supabase/migrations/20260916221506_chat_feature_invite_access.sql',import.meta.url),'utf8'));

let checks=0;
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role}`);
 for(const table of ['chat_feature_members','chat_feature_requests','chat_feature_messages']){await assert.rejects(()=>db.query(`select * from ${table}`),/permission denied/);checks++;}
 await assert.rejects(()=>db.query("select chat_feature_action($1,null,'create','stolen',0)",[owner]),/permission denied/);checks++;
 await assert.rejects(()=>db.query('select claim_chat_feature($1)',[other]),/permission denied/);checks++;
 await db.exec('reset role');
}
await db.exec('set role service_role');
const act=async(actor,id,action,content='',revision=0)=>(await db.query('select chat_feature_action($1,$2,$3,$4,$5) id',[actor,id,action,content,revision])).rows[0].id;
await assert.rejects(()=>act(other,null,'create','Unauthorized'),/access_denied/);checks++;
const id=await act(friend,null,'create','Pinned messages');
await act(friend,id,'message','@Codex help');
await act(friend,id,'proposal','Pin and unpin a message.',1);
await assert.rejects(()=>act(friend,id,'approve','',2),/owner_only/);checks++;
await assert.rejects(()=>act(owner,id,'approve','',1),/changed_or_locked/);checks++;
await act(owner,id,'approve','',2);
await assert.rejects(()=>act(owner,id,'proposal','Silent scope change',2),/changed_or_locked/);checks++;
await assert.rejects(()=>act(owner,id,'approve','',2),/changed_or_locked/);checks++;
const first=(await db.query('select * from claim_chat_feature($1)',[owner])).rows;
assert.equal(first.length,1);assert.equal(first[0].approved_proposal,'Pin and unpin a message.');checks+=2;
assert.equal((await db.query('select * from claim_chat_feature($1)',[friend])).rows.length,0);checks++;
const declined=await act(friend,null,'create','Declined idea');await act(owner,declined,'decline','',1);
assert.equal((await db.query('select * from claim_chat_feature($1)',[friend])).rows.length,0);checks++;
await assert.rejects(()=>db.query('select update_chat_feature_work($1,$2,$3,$4)',[id,friend,'ready','unauthorized']),/claim_not_owned/);checks++;
await db.query('select update_chat_feature_work($1,$2,$3,$4)',[id,owner,'ready','Ready for testing.']);
assert.equal((await db.query('select status from chat_feature_requests where id=$1',[id])).rows[0].status,'ready');checks++;
assert.equal((await db.query("select body from chat_feature_messages where request_id=$1 and author_label='Codex desktop'",[id])).rows[0].body,'Ready for testing.');checks++;
await db.query("insert into chat_feature_members values($1,'participant')",[other]);
await act(other,id,'message','Observing progress');
assert.equal((await db.query("select author_label from chat_feature_messages where author_id=$1",[other])).rows[0].author_label,'Liz Pinon');checks++;
assert.equal((await db.query("select count(*)::int n from chat_feature_members where role='participant'")).rows[0].n,2);checks++;
await assert.rejects(()=>act(other,id,'approve','',2),/owner_only/);checks++;
console.log(`${checks} private feature database checks passed`);
await db.close();
