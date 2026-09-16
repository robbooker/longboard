#!/usr/bin/env node
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const [command='next',id,token,...words]=process.argv.slice(2);
const unwrap=({data,error})=>{if(error)throw error;return data;};
if(command==='releases'){
 console.log(JSON.stringify(unwrap(await db.from('chat_feature_releases').select('request_id,repository,pr_number,head_sha,version,state,approved_by,approved_at,claimed_at,outcome').in('state',['approved','publishing','failed']).order('approved_at')),null,2));
}else if(command==='claim-release'){
 const worker=randomUUID();
 const releases=unwrap(await db.rpc('claim_chat_feature_release',{worker}));
 console.log(JSON.stringify({workerToken:releases?.length?worker:null,release:releases?.[0]??null},null,2));
}else if(command==='prepare-release'){
 const [pr,sha,...summary]=words;
 if(!id||!token||!/^\d+$/.test(pr??'')||!sha||!summary.length)throw Error('Usage: prepare-release REQUEST_ID DEVELOPMENT_TOKEN PR_NUMBER HEAD_SHA summary');
 console.log(JSON.stringify(unwrap(await db.rpc('prepare_chat_feature_release',{feature:id,worker:token,pr:Number(pr),sha,summary:summary.join(' ')}))));
}else if(['release-progress','release-failed','release-published'].includes(command)){
 const [sha,...rest]=words;
 const published=command==='release-published';
 const [merged_commit,deployment,...message]=published?rest:[null,null,...rest];
 if(!id||!token||!sha||!message.length)throw Error('Usage: release-progress|release-failed ID RELEASE_TOKEN HEAD_SHA message; release-published ID RELEASE_TOKEN HEAD_SHA MERGE_SHA DEPLOYMENT_ID message');
 unwrap(await db.rpc('update_chat_feature_release',{feature:id,worker:token,expected_sha:sha,result:command.slice(8),message:message.join(' '),merged_commit,deployment}));
 console.log(JSON.stringify({ok:true}));
}else if(command==='next'){
 const data=unwrap(await db.from('chat_feature_requests').select('id,title,status,approved_proposal,approved_at,claimed_at').in('status',['approved','in_progress','blocked']).order('approved_at').limit(20));
 console.log(JSON.stringify(data,null,2));
}else if(command==='claim'){
 const worker=randomUUID();
 const requests=unwrap(await db.rpc('claim_chat_feature',{worker}));
 console.log(JSON.stringify({workerToken:requests?.length?worker:null,request:requests?.[0]??null},null,2));
}else if(['progress','ready','blocked'].includes(command)){
 const body=words.join(' ').trim();
 if(!id||!token||!body)throw Error('Usage: chat-feature-queue.mjs progress|ready|blocked ID WORKER_TOKEN message');
 unwrap(await db.rpc('update_chat_feature_work',{request_id:id,worker:token,state:command,message:body}));
 console.log(JSON.stringify({ok:true}));
}else throw Error('Unknown command');
