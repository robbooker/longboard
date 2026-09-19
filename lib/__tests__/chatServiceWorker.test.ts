import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function worker(){
 const handlers:Record<string,(event:any)=>void>={};const shown:any[]=[];const opened:string[]=[];
 const self={location:{origin:'https://www.longboardai.com'},addEventListener:(name:string,fn:any)=>handlers[name]=fn,registration:{showNotification:async(...args:any[])=>{shown.push(args);}},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async(url:string)=>{opened.push(url);}},skipWaiting:()=>{}};
 vm.runInNewContext(readFileSync('public/chat-sw.js','utf8'),{self,URL});return {handlers,shown,opened};
}
describe('chat push worker',()=>{
 it('shows generic fallback for malformed payload without a fetch cache',async()=>{const w=worker();let work:Promise<unknown>|undefined;w.handlers.push({data:{json:()=>{throw Error();}},waitUntil:(p:Promise<unknown>)=>work=p});await work;expect(w.shown[0][1].body).toBe('You have new chat activity.');expect(w.handlers.fetch).toBeUndefined();});
 it('rejects external or non-chat click destinations',async()=>{for(const url of ['https://evil.example/chat','/settings','javascript:alert(1)','//evil.example/chat']){const w=worker();let work:Promise<unknown>|undefined;w.handlers.notificationclick({notification:{close:()=>{},data:{url}},waitUntil:(p:Promise<unknown>)=>work=p});await work;expect(w.opened).toEqual(['https://www.longboardai.com/chat']);}});
 it('preserves a conversation URL and opens without replacing another draft',async()=>{const w=worker();let work:Promise<unknown>|undefined;w.handlers.notificationclick({notification:{close:()=>{},data:{url:'/chat?dm=abc'}},waitUntil:(p:Promise<unknown>)=>work=p});await work;expect(w.opened).toEqual(['https://www.longboardai.com/chat?dm=abc']);});
});
