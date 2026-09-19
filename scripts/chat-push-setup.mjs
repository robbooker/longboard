#!/usr/bin/env node
// One-time configuration. Never prints or writes Vercel tokens or VAPID private keys.
import {createECDH} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const hidden=spawnSync('python3',['-c',"import getpass; print(getpass.getpass('Vercel token for the Longboard team (hidden): '))"],{stdio:['inherit','pipe','inherit'],encoding:'utf8'});
if(hidden.status!==0)process.exit(1);
const token=hidden.stdout.trim();if(!token)throw Error('No token entered. Nothing changed.');
const project='longboard',team='longboard';
async function api(path,body){
 const response=await fetch(`https://api.vercel.com${path}${path.includes('?')?'&':'?'}slug=${team}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!response.ok)throw Error(`Vercel configuration request failed (${response.status}). No credential values are logged.`);
 return response.json();
}
const existing=await api(`/v9/projects/${project}/env`);
const keys=['CHAT_PUSH_PUBLIC_KEY','CHAT_PUSH_PRIVATE_KEY','CHAT_PUSH_SUBJECT'];
if((existing.envs||[]).some(env=>keys.includes(env.key)&&env.target?.includes('production')))throw Error('Push configuration already exists or is incomplete. Stopped without rotating keys; review it in Vercel.');
const curve=createECDH('prime256v1');curve.generateKeys();
const values=[curve.getPublicKey().toString('base64url'),curve.getPrivateKey().toString('base64url'),'https://www.longboardai.com'];
await api(`/v10/projects/${project}/env`,keys.map((key,i)=>({key,value:values[i],type:'sensitive',target:['production']})));
const verified=await api(`/v9/projects/${project}/env`);
if(!keys.every(key=>(verified.envs||[]).some(env=>env.key===key&&env.target?.includes('production'))))throw Error('Configuration verification incomplete. Review Vercel before retrying.');
console.log('Three production push variables saved and verified. No deployment was started. Publish through the approved release service.');
