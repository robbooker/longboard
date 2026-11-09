// #410 profile pictures: the shared chat fixture on its own ports, with the two picture buckets
// (chat-avatar-uploads, private; chat-avatars, public-read) answered in memory. Synthetic only.
// Test controls: GET /test/avatar-objects lists every stored picture object (bucket, path, size,
// content type, cache control) and GET /test/avatar-object?bucket=&path= returns one object's bytes.
import { readFile, writeFile, unlink } from 'node:fs/promises';
const target = new URL(`.chat-avatars-fixture-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('chat-mobile-fixture.mjs', import.meta.url), 'utf8');
source = source.replaceAll('54404', '54610').replaceAll('3204', '3410');
const storage = `
 if(url.pathname==='/test/avatar-objects'){return send([...avatarObjects].map(([key,o])=>({bucket:key.split('/')[0],path:key.slice(key.indexOf('/')+1),size:o.bytes.length,mime:o.mime,cacheControl:o.cacheControl})));}
 if(url.pathname==='/test/avatar-object'){const o=avatarObjects.get(url.searchParams.get('bucket')+'/'+url.searchParams.get('path'));if(!o)return send({message:'Not found'},404);res.writeHead(200,{'content-type':o.mime});return res.end(o.bytes);}
 {const m=url.pathname.match(/^\\/storage\\/v1\\/(object(?:\\/upload\\/sign|\\/sign|\\/public)?)\\/(chat-avatars|chat-avatar-uploads)(?:\\/(.*))?$/);
 if(m){const [,kind,bucket,rest='']=m,key=bucket+'/'+decodeURIComponent(rest),service=bearer==='test-service-role';
  if(kind==='object/public'&&req.method==='GET'&&bucket==='chat-avatars'){const o=avatarObjects.get(key);if(!o)return send({message:'Not found'},404);res.writeHead(200,{'content-type':o.mime,'cache-control':'max-age='+(o.cacheControl||'3600')});return res.end(o.bytes);}
  if(kind==='object/upload/sign'&&req.method==='POST'&&service){const token=crypto.randomUUID();avatarTokens.set(token,key);return send({url:'/object/upload/sign/'+key+'?token='+token});}
  if(kind==='object/upload/sign'&&req.method==='PUT'){if(avatarTokens.get(url.searchParams.get('token'))!==key)return send({message:'Forbidden'},403);avatarTokens.delete(url.searchParams.get('token'));if(bytes.length>10485760)return send({statusCode:'413',error:'Payload too large',message:'The object exceeded the maximum allowed size'},413);if(avatarObjects.has(key))return send({message:'exists'},409);avatarObjects.set(key,{bytes,mime:req.headers['content-type']||'application/octet-stream'});return send({Key:key});}
  if(kind==='object'&&service&&req.method==='GET'){const o=avatarObjects.get(key);if(!o)return send({message:'Object not found'},400);res.writeHead(200,{'content-type':o.mime});return res.end(o.bytes);}
  if(kind==='object'&&service&&(req.method==='POST'||req.method==='PUT')&&rest){if(avatarObjects.has(key)&&req.headers['x-upsert']!=='true'&&req.method==='POST')return send({message:'The resource already exists'},409);avatarObjects.set(key,{bytes,mime:req.headers['content-type'],cacheControl:String(req.headers['cache-control']||'').replace(/^max-age=/,'')});return send({Key:key});}
  if(kind==='object'&&service&&req.method==='DELETE'&&!rest){const removed=[];for(const p of JSON.parse(bytes.toString()).prefixes){if(avatarObjects.delete(bucket+'/'+p))removed.push({name:p});}return send(removed);}
  return send({message:'Forbidden'},403);
 }}
 if(url.pathname.startsWith('/storage/v1/')){`;
source = source.replace(" if(url.pathname.startsWith('/storage/v1/')){", storage);
source = source.replace('const objects=new Map()', 'const avatarObjects=new Map(),avatarTokens=new Map();\nconst objects=new Map()');
await writeFile(target, source);
try { await import(target.href); } finally { await unlink(target); }
