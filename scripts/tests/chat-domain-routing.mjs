import assert from 'node:assert/strict';
import http from 'node:http';
import config from '../../next.config.mjs';
const rules=await config.redirects();
const rule=rules.find(r=>r.source==='/');
const match=new RegExp(`^${rule.has[0].value}$`);
assert.ok(match.test('chat.robbooker.com'));
for(const host of ['www.longboardai.com','chatXrobbookerXcom','chat.robbooker.com.evil.example']) assert.ok(!match.test(host));
assert.equal(rule.permanent,false);
if(process.env.CHAT_TEST_PORT){
 for(const host of ['chat.robbooker.com','www.longboardai.com','chatXrobbookerXcom']) {
  for(const path of ['/?room=shortscout','/chat/login']) {
   const result=await new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:Number(process.env.CHAT_TEST_PORT),path,headers:{host}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,location:r.headers.location,body}));}).on('error',reject);});
   const redirect=host==='chat.robbooker.com'&&path.startsWith('/?');
   assert.equal(result.status,redirect?307:200);
   assert.equal(result.location,redirect?'/chat?room=shortscout':undefined);
   if(path==='/chat/login')assert.match(result.body,/Sign in to chat/);
  }
 }
}
console.log('Exact-host routing and legacy compatibility passed');
