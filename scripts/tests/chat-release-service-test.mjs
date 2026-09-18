import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runRelease,validatePlan,apiClient,REPO,VERCEL_PROJECT} from '../chat-release-service.mjs';
const id='11111111-1111-4111-8111-111111111111',head='a'.repeat(40),integration='b'.repeat(40),merge='c'.repeat(40);
function fixture(options={}) {
 const calls=[];let pullReads=0,migrated=false;
 const release={request_id:id,repository:REPO,head_sha:head,pr_number:288,version:1,state:'approved',approved_by:id,approved_at:'2026-09-18T12:00:00Z'};
 const migration={path:'supabase/migrations/20260918120000_test.sql',sha256:createHash('sha256').update('select 1;').digest('hex'),backwardCompatible:true};
 const plan={version:1,requestId:id,migrations:options.migration?[migration]:[],probes:[{path:'/chat/login',status:200,contains:'Sign in'}]};
 const pr=()=>({head:{sha:options.changedHead?'d'.repeat(40):head,repo:{full_name:REPO}},base:{ref:'main',repo:{full_name:REPO,id:123}},state:'open',merged:false,mergeable:options.calculating?null:true,merge_commit_sha:options.movedBase&&pullReads>1?'d'.repeat(40):integration,node_id:'PR_test',draft:true});
 const api=async(service,path,body,method)=>{
  calls.push({service,path,body,method});
  if(service==='supabase'&&path.endsWith('/database/query')) {
   const q=body.query;
   if(q.startsWith('select 1'))return [{release_connection_check:1}];
   if(q.startsWith('select l.*'))return options.idle?[]:[release];
   if(q.startsWith('update public.chat_feature_releases'))return options.lostClaim?[]:[{request_id:id}];
   if(q.startsWith('select name'))return (migrated||options.priorMigration)?[{name:'test'}]:[];
   if(q.startsWith('select l.request_id'))return options.revoked?[]:[{request_id:id}];
   if(q.includes('update_chat_feature_release'))return [];
  }
  if(service==='supabase'&&path.endsWith('/database/migrations')){migrated=true;return {};}
  if(service==='github') {
   if(path.endsWith('/git/ref/heads/main'))return {object:{sha:'e'.repeat(40)}};
   if(path.includes('/git/commits/'))return {parents:[{sha:'e'.repeat(40)},{sha:head}]};
   if(path.endsWith('/pulls/288')){pullReads++;return pr();}
   if(path.includes('/files?'))return options.infrastructure?[{filename:'.github/workflows/danger.yml',status:'added'}]:options.migration?[{filename:migration.path,status:'added'}]:[];
   if(path.includes('/contents/')){const content=path.includes('/.release/')?JSON.stringify(plan):'select 1;';return {type:'file',encoding:'base64',size:content.length,content:Buffer.from(content).toString('base64')};}
   if(path.includes('/check-runs'))return {total_count:1,check_runs:[{name:'Chat release checks',app:{slug:'github-actions'},head_sha:integration,status:options.pendingCheck?'in_progress':'completed',conclusion:options.failedCheck?'failure':'success'}]};
   if(path.endsWith('/status'))return {statuses:[]};
   if(path.endsWith('/protection'))return {enforce_admins:{enabled:!options.adminBypass},required_status_checks:{strict:!options.unprotected,contexts:['Chat release checks']},required_pull_request_reviews:{bypass_pull_request_allowances:{users:options.allowBypass?[{}]:[],teams:[],apps:[]}}};
   if(path==='/graphql')return {};
   if(path.endsWith('/merge'))return {merged:true,sha:merge};
  }
  if(service==='vercel') {
   if(path.startsWith('/v9/projects/'))return {id:VERCEL_PROJECT};
   if(path.startsWith('/v4/aliases/'))return {deployment:{id:options.wrongAlias?'dpl_wrong':'dpl_test'}};
   if(path.startsWith('/v13/deployments?'))return {id:'dpl_test'};
   return {id:'dpl_test',target:'production',projectId:VERCEL_PROJECT,readyState:options.deployError?'ERROR':'READY',meta:{githubCommitSha:options.wrongCommit?head:merge}};
  }
  throw Error(`Unexpected fixture call ${service} ${path}`);
 };
 return {calls,api,run:dryRun=>runRelease({api,runId:'123',dryRun,fetcher:async()=>({status:200,text:async()=>options.probeFailure?'Wrong page':'Sign in'}),sleep:async()=>{}})};
}
test('publishes exact approved head only after checks, deployment and live probes',async()=>{
 const f=fixture();assert.deepEqual(await f.run(false),{status:'published',pr:288});
 const mergeCall=f.calls.find(c=>c.path.endsWith('/merge'));assert.equal(mergeCall.body.sha,head);
 const final=f.calls.at(-1).body.query;assert.ok(final.includes("'published'"));assert.ok(final.includes(merge));assert.ok(final.includes('dpl_test'));
});
test('dry run performs no writes, migrations, ready mutation, merge or deployment',async()=>{
 const f=fixture({migration:true});assert.equal((await f.run(true)).status,'validated');
 assert.ok(f.calls.every(c=>!c.body || (c.path.endsWith('/database/query')&&c.body.query.startsWith('select l.*'))));
});
test('empty queue does nothing',async()=>{const f=fixture({idle:true});assert.equal((await f.run(false)).status,'idle');assert.equal(f.calls.length,1);});
test('lost atomic claim does not merge',async()=>{const f=fixture({lostClaim:true});assert.equal((await f.run(false)).status,'lost_claim');assert.ok(!f.calls.some(c=>c.path.endsWith('/merge')));});
for(const option of ['changedHead','infrastructure','failedCheck','unprotected','adminBypass','allowBypass','movedBase','revoked'])test(`${option} blocks merge and records failure`,async()=>{
 const f=fixture({[option]:true});await assert.rejects(f.run(false));assert.ok(!f.calls.some(c=>c.path.endsWith('/merge')));assert.ok(f.calls.at(-1).body.query.includes("'failed'"));
});
for(const option of ['deployError','wrongCommit','wrongAlias','probeFailure'])test(`${option} never marks published`,async()=>{
 const f=fixture({[option]:true});await assert.rejects(f.run(false));assert.ok(f.calls.at(-1).body.query.includes("'failed'"));assert.ok(!f.calls.some(c=>c.body?.query?.includes("'published'")));
});
test('migration verified before merge',async()=>{
 const f=fixture({migration:true});await f.run(false);const index=f.calls.findIndex(c=>c.path.endsWith('/database/migrations'));assert.ok(index>0&&index<f.calls.findIndex(c=>c.path.endsWith('/merge')));assert.ok(f.calls[index+1].body.query.startsWith('select name'));
});
test('unlisted, modified and unsafe migrations rejected',()=>{
 const base={version:1,requestId:id,migrations:[],probes:[{path:'/chat/login',status:200,contains:'Sign in'}]};
 assert.throws(()=>validatePlan(base,[{filename:'supabase/migrations/test.sql',status:'modified'}],id));
 assert.throws(()=>validatePlan({...base,probes:[{path:'//evil.com',status:200,contains:'yes'}]},[],id));
 assert.throws(()=>validatePlan({...base,requestId:'wrong'},[],id));
});
test('API redirects forbidden and response errors never expose bodies',async()=>{
 let init;const api=apiClient({GITHUB_TOKEN:'secret',SUPABASE_RELEASE_TOKEN:'secret',VERCEL_RELEASE_TOKEN:'secret'},async(url,args)=>{init=args;return {ok:false,status:403,text:async()=> 'secret'};});
 await assert.rejects(api('github','/test'),error=>error.message==='github API GET failed (403)');assert.equal(init.redirect,'error');
});

test('previous migration stops reconfirmation without repeating DDL',async()=>{const f=fixture({migration:true,priorMigration:true});await assert.rejects(f.run(false),/operator inspection/);assert.ok(!f.calls.some(c=>c.path.endsWith('/database/migrations')));});
test('renamed migrations cannot escape review',()=>{assert.throws(()=>validatePlan({version:1,requestId:id,migrations:[],probes:[{path:'/chat/login',status:200,contains:'Sign in'}]},[{filename:'elsewhere.sql',previous_filename:'supabase/migrations/20260918120000_test.sql',status:'renamed'}],id));});

for(const option of ['calculating','pendingCheck'])test(`${option} waits without changing approval or claiming`,async()=>{const f=fixture({[option]:true});assert.equal((await f.run(false)).status,'waiting');assert.ok(!f.calls.some(c=>c.body?.query?.startsWith('update')||c.body?.query?.includes('update_chat_feature_release')));});
test('all three credentials can be verified without reading or writing release records',async()=>{const f=fixture();assert.equal((await runRelease({api:f.api,runId:'123',dryRun:true,credentialsOnly:true})).status,'credentials_verified');assert.equal(f.calls.length,3);assert.ok(!f.calls.some(c=>c.body?.query?.includes('chat_feature_releases')));});
