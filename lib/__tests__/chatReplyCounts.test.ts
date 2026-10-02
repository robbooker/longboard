import {expect,it,vi} from 'vitest';
import {readReplyCounts,replyCountIds} from '../chatReplyCounts';
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
