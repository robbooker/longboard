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
 it('uses the native title/body with plain-text Unicode bounds and legacy fallback',async()=>{for(const payload of [{title:'Social reply - Luke',body:'Hello'},{title:'<b>DM</b>\u202e - Luke',body:'🦄'.repeat(41)},{body:'Legacy sender: '+ 'x'.repeat(200)},{title:42,body:null}]){const w=worker();let work:Promise<unknown>|undefined;w.handlers.push({data:{json:()=>payload},waitUntil:(p:Promise<unknown>)=>work=p});await work;const [title,options]=w.shown[0];expect(Array.from(title).length).toBeLessThanOrEqual(64);expect(Array.from(options.body).length).toBeLessThanOrEqual(40);expect(title).not.toMatch(/[<>\u202e]/);expect(options.body).not.toMatch(/[\ud800-\udfff]/u);expect(options).toMatchObject({icon:'/chat-rb-icon-v1-192.png',badge:'/chat-badge.png',tag:'chat-activity'});if(payload.title==='Social reply - Luke')expect([title,options.body]).toEqual(['Social reply - Luke','Hello']);if(!payload.title||typeof payload.title!=='string')expect(title).toBe('Rob Booker Chat');}});
 it('rejects external or non-chat click destinations',async()=>{for(const url of ['https://evil.example/chat','/settings','javascript:alert(1)','//evil.example/chat']){const w=worker();let work:Promise<unknown>|undefined;w.handlers.notificationclick({notification:{close:()=>{},data:{url}},waitUntil:(p:Promise<unknown>)=>work=p});await work;expect(w.opened).toEqual(['https://www.longboardai.com/chat']);}});
 it('preserves a conversation URL and opens without replacing another draft',async()=>{const w=worker();let work:Promise<unknown>|undefined;w.handlers.notificationclick({notification:{close:()=>{},data:{url:'/chat?dm=abc'}},waitUntil:(p:Promise<unknown>)=>work=p});await work;expect(w.opened).toEqual(['https://www.longboardai.com/chat?dm=abc']);});
});
