import {expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readRoomWindow,roomWindowQuery} from '@/lib/chatReads/window';
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const parent=uuid(999);
type Row={id:string;room_slug:string;removed:boolean;reply_to_id:string|null;unread_seq:number;deleted_at?:string};
function fixture(rows:Row[]){
 const reads:{limit:number;room:boolean;parent:boolean}[]=[];
 const from=()=>{
  let predicates:((row:Row)=>boolean)[]=[],column:keyof Row='unread_seq',ascending=true,limit=Infinity,single=false;
  const audit={limit,room:false,parent:false};reads.push(audit);
  const q={select:()=>q,eq:(key:keyof Row,value:unknown)=>{predicates.push(row=>row[key]===value);if(key==='room_slug')audit.room=true;if(key==='reply_to_id')audit.parent=true;return q;},is:(key:keyof Row,value:unknown)=>q.eq(key,value),lt:(key:keyof Row,value:number)=>{predicates.push(row=>Number(row[key])<Number(value));return q;},gt:(key:keyof Row,value:number)=>{predicates.push(row=>Number(row[key])>Number(value));return q;},gte:(key:keyof Row,value:number)=>{predicates.push(row=>Number(row[key])>=Number(value));return q;},lte:(key:keyof Row,value:number)=>{predicates.push(row=>Number(row[key])<=Number(value));return q;},order:(key:keyof Row,options:{ascending:boolean})=>{column=key;ascending=options.ascending;return q;},limit:(n:number)=>{limit=n;audit.limit=n;return q;},maybeSingle:()=>{single=true;audit.limit=1;return q;},then:(resolve:(result:unknown)=>unknown)=>{const result=rows.filter(row=>predicates.every(predicate=>predicate(row))).sort((a,b)=>(Number(a[column])-Number(b[column]))*(ascending?1:-1)).slice(0,limit);return Promise.resolve({data:single?result[0]??null:result,error:null}).then(resolve);}};
  return q;
 };
 return {db:{from} as unknown as SupabaseClient,reads};
}
const history=(reply_to_id:string|null=null):Row[]=>Array.from({length:250},(_,i)=>({id:uuid(i+1),room_slug:'main',removed:false,reply_to_id,unread_seq:i+1}));
it.each([['',null,80],['thread',parent,100]] as const)('loads bounded contiguous %s context around old unread, with exact room/parent predicates',async(_kind,thread,limit)=>{
 const f=fixture([...history(thread),{...history(thread)[0],id:uuid(500),room_slug:'social',unread_seq:41}]);
 const result=await readRoomWindow(f.db,'main',thread,new URLSearchParams(`around=${uuid(41)}`),'*',limit);
 expect(result.messages.map(row=>row.unread_seq)).toEqual(Array.from({length:limit},(_,i)=>i+1));
 expect(result.range).toBe(`1,${limit}`);expect(result.hasMore).toBe(false);expect(result.hasNewer).toBe(true);
 expect(f.reads).toHaveLength(5);expect(f.reads.every(read=>read.limit<=limit&&read.room&&read.parent)).toBe(true);
});
it('pages forward/backward without skipping boundary records at 80/81/100/101',async()=>{
 const f=fixture(history());
 const next=await readRoomWindow(f.db,'main',null,new URLSearchParams('after=80'),'*',80);
 expect(next.messages[0].unread_seq).toBe(81);expect(next.messages.at(-1)?.unread_seq).toBe(160);
 const previous=await readRoomWindow(f.db,'main',null,new URLSearchParams('before=81'),'*',80);
 expect(previous.messages.map(row=>row.unread_seq)).toEqual(Array.from({length:80},(_,i)=>i+1));
 expect(previous.hasNewer).toBe(true);
});
it('range reconciliation excludes new messages, keeps retained tombstones and excludes removed rows',async()=>{
 const rows=history(parent);rows[9].removed=true;rows[10].deleted_at='2026-01-01';
 const result=await readRoomWindow(fixture(rows).db,'main',parent,new URLSearchParams('range=1,100'),'*',100);
 expect(result.messages).toHaveLength(99);expect(result.messages.some(row=>row.id===uuid(10))).toBe(false);expect(result.messages.some(row=>row.id===uuid(11))).toBe(true);expect(result.hasNewer).toBe(true);
});
it.each(['around=bad','before=-1','after=0','before=9007199254740992','range=1,0','range=2,1','range=1,2,3',`around=${uuid(1)}&after=1`])('rejects invalid or ambiguous window %s',query=>expect(()=>roomWindowQuery(new URLSearchParams(query))).toThrow('invalid_window'));
it.each([null,parent])('cannot resolve another room, removed or different-parent anchor %s',async thread=>{
 const rows=[{...history(thread)[0],room_slug:'social'}, {...history(thread)[1],removed:true}, {...history(thread)[2],reply_to_id:thread?null:parent}];
 for(const row of rows)await expect(readRoomWindow(fixture(rows).db,'main',thread,new URLSearchParams(`around=${row.id}`),'*',80)).rejects.toMatchObject({status:404});
});

it('keeps neighboring navigation and stable range when every visible row is concurrently removed',async()=>{
 const rows=history();for(const row of rows)if(row.unread_seq>=81&&row.unread_seq<=160)row.removed=true;
 const page=await readRoomWindow(fixture(rows).db,'main',null,new URLSearchParams('range=81,160'),'*',80);
 expect(page).toMatchObject({messages:[],range:'81,160',hasMore:true,hasNewer:true});
});
