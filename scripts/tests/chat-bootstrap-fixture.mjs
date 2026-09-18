// Isolated S02 benchmark: synthetic accounts only, optional per-service-call latency.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-bootstrap-fixture-${process.pid}.mjs`,import.meta.url);
let adapter=await readFile(new URL('chat-updates-fixture.mjs',import.meta.url),'utf8');
adapter=adapter.replaceAll('54440','54450').replaceAll('3240','3250');
adapter=adapter.replace('await writeFile(target,source);',`source=source.replace("const server=createServer((req,res)=>{queue=queue.then(async()=>{",\`const spans=[]; const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/test/reset-trace'){spans.length=0;res.end('{}');return;}
 if(path==='/test/trace'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(spans));return;}
 const span={path,method:req.method,start:Date.now()};res.once('finish',()=>spans.push({...span,end:Date.now(),status:res.statusCode}));
 await new Promise(resolve=>setTimeout(resolve,Number(process.env.FIXTURE_LATENCY_MS||0)));
 queue=queue.then(async()=>{\`);
source=source.replace("res.setHeader('Access-Control-Allow-Origin','http://localhost:3250')","res.setHeader('Access-Control-Allow-Origin',['http://localhost:3250','http://localhost:3251','http://localhost:3252'].includes(req.headers.origin)?req.headers.origin:'http://localhost:3250')");
await writeFile(target,source);`);
await writeFile(target,adapter);
try{await import(target.href);}finally{await unlink(target);}
