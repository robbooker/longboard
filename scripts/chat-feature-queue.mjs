#!/usr/bin/env node
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const [command='next',id,token,...words]=process.argv.slice(2);
const unwrap=({data,error})=>{if(error)throw error;return data;};
if(command==='next'){
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
