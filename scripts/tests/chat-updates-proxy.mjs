import http from 'node:http';import fs from 'node:fs';
const events=[];http.createServer((req,res)=>{
 events.push({at:Date.now(),method:req.method,path:req.url});fs.writeFileSync('/tmp/chat-s01-requests.json',JSON.stringify(events));
 const upstream=http.request({hostname:'127.0.0.1',port:3241,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end('Dev server unavailable');});req.pipe(upstream);
}).listen(3240,'127.0.0.1');
