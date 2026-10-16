import {expect,it,vi} from 'vitest';
import {readReplyCounts,readReplyThreads,replyCountIds,shareReplyThreads} from '../chatReplyCounts';
import {threadReplyAge} from '../chatTimestamp';
const ids=Array.from({length:100},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const rows=(path:string,value=1)=>Object.fromEntries(new URL(path,'https://chat.test').searchParams.get('ids')!.split(',').map(id=>[id,value]));

it('sorts and deduplicates canonical targets for stable bounded resources',()=>{
 expect(replyCountIds([ids[81],ids[0],ids[81],'',ids[79]].join(','))).toEqual([ids[0],ids[79],ids[81]]);
});
it.each([0,1,80,81,100])('reads all %i targets in batches of at most80',async size=>{
 const read=vi.fn(async(path:string)=>Response.json({counts:rows(path)}));
 const result=await readReplyCounts('shortscout',ids.slice(0,size),read,'opaque-1');
 expect(Object.keys(result)).toEqual(ids.slice(0,size));
 expect(read).toHaveBeenCalledTimes(Math.ceil(size/80));
 for(const [path]of read.mock.calls){const params=new URL(path,'https://chat.test').searchParams;expect(params.get('ids')!.split(',').length).toBeLessThanOrEqual(80);expect(params.get('view')).toBe('opaque-1');expect(params.get('room')).toBe('shortscout');}
});
it('waits for both chunks and combines out-of-order responses without truncation',async()=>{
 const resolve:Array<(response:Response)=>void>=[];const paths:string[]=[];
 const pending=readReplyCounts('main',ids,path=>{paths.push(path);return new Promise(yes=>resolve.push(yes));});
 let complete=false;void pending.then(()=>{complete=true;});
 resolve[1](Response.json({counts:rows(paths[1],2)}));await Promise.resolve();expect(complete).toBe(false);
 resolve[0](Response.json({counts:rows(paths[0],1)}));const result=await pending;
 expect([result[ids[78]],result[ids[79]],result[ids[80]],result[ids[99]]]).toEqual([1,1,2,2]);
});
it('rejects a partial refresh instead of publishing incomplete counts',async()=>{
 const read=vi.fn(async(path:string)=>path.includes(ids[80])?Response.json({error:'unavailable'},{status:503}):Response.json({counts:rows(path,4)}));
 await expect(readReplyCounts('main',ids,read)).rejects.toThrow('unavailable');
 expect(read).toHaveBeenCalledTimes(2);
});
it('ignores unrequested targets and retains an authoritative zero',async()=>{
 const result=await readReplyCounts('main',[ids[0],ids[1]],async()=>Response.json({counts:{[ids[0]]:0,[ids[99]]:200}}));
 expect(result).toEqual({[ids[0]]:0});
});
it.each([null,[],{[ids[0]]:-1},{[ids[0]]:1.5},{[ids[0]]:'3'}])('rejects malformed count payloads',async counts=>{
 await expect(readReplyCounts('main',[ids[0]],async()=>Response.json({counts}))).rejects.toThrow('Invalid reply count');
});

it('reads thread details with the counts and ignores them for older servers or zero counts',async()=>{
 const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
 const thread={last:'2026-10-15T12:00:00Z',people:[{key:'m',name:'Ann',member:'m'},{key:'x',name:7}]};
 const result=await readReplyThreads('main',[a,b],async()=>Response.json({counts:{[a]:2,[b]:0},threads:{[a]:thread,[b]:thread}}));
 expect(result).toEqual({counts:{[a]:2,[b]:0},threads:{[a]:{last:thread.last,people:[{key:'m',name:'Ann',member:'m'}]}}});
 expect((await readReplyThreads('main',[a],async()=>Response.json({counts:{[a]:2}}))).threads).toEqual({});
});
it('keeps unchanged thread objects so memoized rows skip re-rendering',()=>{
 const one={last:'2026-10-15T12:00:00Z',people:[{key:'m',name:'Ann'}]},two={last:'2026-10-15T12:05:00Z',people:[{key:'m',name:'Ann'}]};
 const previous={a:one,b:two};
 expect(shareReplyThreads(previous,{a:{...one,people:[{key:'m',name:'Ann'}]},b:{...two}})).toBe(previous);
 const changed=shareReplyThreads(previous,{a:{...one},b:{...two,last:'2026-10-15T12:06:00Z'}});
 expect(changed).not.toBe(previous);expect(changed.a).toBe(one);expect(changed.b.last).toBe('2026-10-15T12:06:00Z');
});
it('says how long ago the last reply came',()=>{
 const now=Date.parse('2026-10-15T12:00:00Z');
 expect(threadReplyAge('2026-10-15T11:59:40Z',now)).toBe('just now');
 expect(threadReplyAge('2026-10-15T11:57:00Z',now)).toBe('3 min ago');
 expect(threadReplyAge('2026-10-15T09:30:00Z',now)).toBe('2 hr ago');
 expect(threadReplyAge('2026-10-14T09:00:00Z',now)).toBe('1 day ago');
 expect(threadReplyAge('2026-10-01T09:00:00Z',now)).toBe('Oct 1');
});
