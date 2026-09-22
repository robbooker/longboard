// Cross-repository wire interoperability: actual producer + actual consumer, only source records stubbed.
import assert from 'node:assert/strict';
const consumer=await import('../../lib/chatMembershipExport.ts');
const {createMembershipExportConsumer}=consumer.default??consumer;
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {membershipExportHandler}=await import(pathToFileURL(resolve(process.env.CHAT_MEMBERSHIP_PRODUCER_DIR??'../shortscout-membership-export','supabase/functions/chat-membership-export/handler.ts')).href);

async function main(){
 const key='synthetic-test-key-never-a-production-secret',a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 let clock=1_800_000_000_000,calls=0,fail=false,offset=0;
 let state={subject:a,state:'update',level:'mastermind'};
 const handler=membershipExportHandler({key,now:()=>clock+offset,lookup:async subjects=>{calls++;if(fail)throw Error('source unavailable');return subjects.map(subject=>subject===a?state:{subject,state:'update',level:'monthly'});}});
 const transport=async(input,init)=>handler(new Request(input,init));
 const read=createMembershipExportConsumer({key:()=>key,request:transport,now:()=>clock});
 assert.deepEqual(await read([a,b]),new Set([a,b]));assert.equal(calls,1);
 state={subject:a,state:'revoke',level:'free'};clock+=60000;assert.deepEqual(await read([a,b]),new Set([b]));
 state={subject:a,state:'update',level:'annual'};clock+=60000;assert.deepEqual(await read([a]),new Set([a]));
 state={subject:a,state:'delete',level:null};clock+=60000;assert.deepEqual(await read([a]),new Set());
 state={subject:a,state:'update',level:'lifetime'};clock+=60000;assert.deepEqual(await read([a]),new Set([a]));
 fail=true;clock+=60000;assert.deepEqual(await read([a]),new Set());fail=false;clock+=5000;assert.deepEqual(await read([a]),new Set([a]));
 offset=-61000;clock+=60000;assert.deepEqual(await read([a]),new Set(),'stale producer fails closed');
 const wrong=createMembershipExportConsumer({key:()=>key+'wrong',request:transport,now:()=>clock});offset=0;assert.deepEqual(await wrong([a]),new Set(),'wrong shared key never yields membership');
 console.log('PASS cross-repo actual producer/consumer: HMAC/raw digest/nonce interoperability; all paid tiers, free/deleted, expiry, source failure/recovery, stale producer, wrong key; no member login.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
