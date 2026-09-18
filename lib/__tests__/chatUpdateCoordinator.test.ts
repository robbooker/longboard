import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ChatUpdateCoordinator} from '../chatUpdateCoordinator';
let active=true;
const controllers:ChatUpdateCoordinator[]=[];
const reply=(paths:string[])=>Response.json({results:paths.map(path=>({path,status:200,data:{path}}))});
function setup(pollingRoom=false){
 const transport=vi.fn(async (_url:unknown,init?:RequestInit)=>reply(JSON.parse(init!.body as string).paths));
 const c=new ChatUpdateCoordinator({fetch:transport as typeof fetch,active:()=>active,now:()=>Date.now()},pollingRoom);
 controllers.push(c);c.start();return {c,transport};
}
const advance=(ms:number)=>vi.advanceTimersByTimeAsync(ms);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);active=true;});
afterEach(()=>{controllers.forEach(c=>c.stop());controllers.length=0;vi.useRealTimers();});
it('batches distinct resources and deduplicates concurrent readers without sharing consumed bodies',async()=>{
 const {c,transport}=setup();
 const a=c.read('/api/chat/activity'),b=c.read('/api/chat/inbox'),duplicate=c.read('/api/chat/activity');
 await advance(25);
 expect(transport).toHaveBeenCalledTimes(1);
 expect(await (await a).json()).toEqual(await(await duplicate).json());
 expect(await(await b).json()).toEqual({path:'/api/chat/inbox'});
});
it('uses at most six idle HTTP batches per minute when realtime is healthy, including a later-opened thread',async()=>{
 const {c,transport}=setup();c.setHealthy(true);
 for(const [path,topic] of [['/api/chat/activity','activity'],['/api/chat/inbox','inbox'],['/api/chat?room=social','status'],['/api/chat/history?room=social','room']] as const)c.watch(()=>c.read(path),[topic],true);
 await advance(25);transport.mockClear();
 await advance(3000);
 c.watch(()=>c.read('/api/chat/thread?room=social&messageId=1'),['room'],true);
 await advance(25);transport.mockClear();
 await advance(60000);
 expect(transport.mock.calls.length).toBeLessThanOrEqual(6);
});
it('retains fast fallback for cookie-only/unauthorized realtime rooms even on a healthy socket',async()=>{
 const {c,transport}=setup(true);c.setHealthy(true);
 c.watch(()=>c.read('/api/chat/history?room=shortscout'),['history'],true,60000);
 c.watch(()=>c.read('/api/chat/inbox'),['inbox']);
 await advance(25);transport.mockClear();await advance(10000);
 expect(transport).toHaveBeenCalledTimes(5);
 expect(transport.mock.calls.filter(([,init])=>(init?.body as string).includes('/api/chat/inbox'))).toHaveLength(1);
});
it('coalesces event bursts and performs exactly one follow-up when invalidated during a slow request',async()=>{
 const {c,transport}=setup();c.setHealthy(true);
 let release!:(response:Response)=>void;
 transport.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 c.watch(()=>c.read('/api/chat/activity'),['activity'],true);
 await advance(25);
 for(let i=0;i<20;i++)c.invalidate('activity');
 await advance(500);expect(transport).toHaveBeenCalledTimes(1);
 release(reply(['/api/chat/activity']));await advance(100);
 expect(transport).toHaveBeenCalledTimes(2);
});
it('does not turn a slow request into continuous catch-up polling',async()=>{
 const {c,transport}=setup();
 let release!:(response:Response)=>void;
 transport.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 c.watch(()=>c.read('/api/chat/activity'),['activity'],true);
 await advance(9000);expect(transport).toHaveBeenCalledTimes(1);
 release(reply(['/api/chat/activity']));await advance(300);
 expect(transport).toHaveBeenCalledTimes(1);
 await advance(1000);expect(transport).toHaveBeenCalledTimes(2);
});
it('pauses all hidden/offline reads and batches one reconciliation when foregrounded',async()=>{
 const {c,transport}=setup();c.watch(()=>c.read('/api/chat/activity'),['activity'],true);
 await advance(25);transport.mockClear();active=false;
 c.invalidate('activity');await advance(60000);expect(transport).not.toHaveBeenCalled();
 const queued=c.read('/api/chat/inbox');await advance(100);expect(transport).not.toHaveBeenCalled();
 active=true;c.foreground();await advance(25);await queued;
 expect(transport).toHaveBeenCalledTimes(1);
});
it('removes a hidden room watcher while other resources stay active',async()=>{
 const {c,transport}=setup();const stop=c.watch(()=>c.read('/api/chat/history?room=social'),['room'],true);
 c.watch(()=>c.read('/api/chat/inbox'),['inbox']);await advance(25);stop();transport.mockClear();
 await advance(10000);expect(transport).toHaveBeenCalledTimes(1);
 expect(transport.mock.calls[0][1]?.body).not.toContain('history');
});
it('recovers immediately on realtime disconnect and reconnect',async()=>{
 const {c,transport}=setup();c.setHealthy(true);c.watch(()=>c.read('/api/chat/activity'),['activity'],true);
 await advance(25);transport.mockClear();c.setHealthy(false);await advance(25);expect(transport).toHaveBeenCalledTimes(1);
 await advance(2100);expect(transport).toHaveBeenCalledTimes(2);
 c.setHealthy(true);await advance(25);expect(transport).toHaveBeenCalledTimes(3);
});
it('clears aborted work across Strict Mode stop/start and settles each reader',async()=>{
 const {c,transport}=setup();const old=c.read('/api/chat/activity');const rejected=expect(old).rejects.toThrow('session changed');
 c.stop();await rejected;c.start();const next=c.read('/api/chat/activity');await advance(25);expect((await next).ok).toBe(true);expect(transport).toHaveBeenCalledTimes(1);
});
it('bounds batches and isolates resource errors',async()=>{
 const {c,transport}=setup();const reads=Array.from({length:12},(_,i)=>c.read(`/api/chat/inbox?conversation=${i}`));await advance(50);await Promise.all(reads);
 expect(transport).toHaveBeenCalledTimes(2);expect(JSON.parse(transport.mock.calls[0][1]!.body as string).paths).toHaveLength(8);
 transport.mockResolvedValueOnce(Response.json({error:'unauthenticated'},{status:401}));const next=c.read('/api/chat/activity');await advance(25);expect((await next).status).toBe(401);
});
it('notifies the shell when authoritative session access is revoked',async()=>{
 const unauthorized=vi.fn();
 const c=new ChatUpdateCoordinator({fetch:vi.fn(async()=>Response.json({error:'unauthenticated'},{status:401})) as typeof fetch,active:()=>true,now:()=>Date.now(),unauthorized});controllers.push(c);c.start();
 const pending=c.read('/api/chat/activity');await advance(25);expect((await pending).status).toBe(401);expect(unauthorized).toHaveBeenCalledTimes(1);
});
it('retries after a failed transport instead of retaining a rejected in-flight read',async()=>{
 const {c,transport}=setup();transport.mockRejectedValueOnce(new Error('offline'));
 const first=c.read('/api/chat/activity');const failed=expect(first).rejects.toThrow('offline');await advance(25);await failed;
 const retry=c.read('/api/chat/activity');await advance(25);expect((await retry).ok).toBe(true);expect(transport).toHaveBeenCalledTimes(2);
});
it('reconciles healthy room history only once per minute while batching the ten-second metadata checks',async()=>{
 const {c,transport}=setup();c.setHealthy(true);
 c.watch(()=>c.read('/api/chat/history?room=social'),['history'],true,60000);
 c.watch(()=>c.read('/api/chat/activity'),['activity'],true);
 await advance(25);transport.mockClear();await advance(60000);
 expect(transport).toHaveBeenCalledTimes(6);
 expect(transport.mock.calls.filter(([,init])=>(init?.body as string).includes('/api/chat/history'))).toHaveLength(1);
});
