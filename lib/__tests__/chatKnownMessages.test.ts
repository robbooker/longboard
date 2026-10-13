import {expect,it} from 'vitest';
import {knownMessagesParam} from '../chatKnownMessages';
const row=(n:number,extra={})=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,unread_seq:n,...extra});
it('sends the held room positions as one range',()=>{
 expect(knownMessagesParam([row(12),row(40),row(13)])).toBe('known=12-40');
 expect(knownMessagesParam([])).toBe('ids=');
});
it('ignores pending sends and keeps the latest 200 rows, as before',()=>{
 const rows=Array.from({length:250},(_,i)=>row(i+1));
 expect(knownMessagesParam([...rows,{id:'pending',pending:true}])).toBe('known=51-250');
 expect(knownMessagesParam([{id:'pending',pending:true,unread_seq:null}])).toBe('ids=');
});
it('falls back to IDs when any row has no position',()=>{
 expect(knownMessagesParam([row(1),{id:row(2).id,unread_seq:null}])).toBe(`ids=${row(1).id},${row(2).id}`);
 expect(knownMessagesParam([row(1),{id:row(2).id}])).toBe(`ids=${row(1).id},${row(2).id}`);
});
