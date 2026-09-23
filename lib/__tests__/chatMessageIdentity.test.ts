import {describe,it,expect} from 'vitest';
import {reconcileRoomMessages,sameChatMessage} from '../chatMessageIdentity';
import type {PublicChatMessage} from '../publicChat';
const row:PublicChatMessage={id:'1',guest_id:'g',author_label:'Alice',body:'Hi',created_at:'2026-09-19',attachment_ids:['a','b']};
describe('room snapshot identity',()=>{
 it('reuses the list and rows on unchanged fresh JSON',()=>{const current=[row];expect(reconcileRoomMessages(current,JSON.parse(JSON.stringify(current)))).toBe(current);});
 it('replaces only changed rows and respects server deletion/order',()=>{const second={...row,id:'2'};const changed={...row,body:'Edited'};const result=reconcileRoomMessages([row,second],[{...second},changed]);expect(result[0]).toBe(second);expect(result[1]).toBe(changed);expect(reconcileRoomMessages([row,second],[{...second}])).toEqual([second]);});
 it('reconciles independent membership additions and removals without a message edit',()=>{const original={...row,memberships:['LB'] as const};const dual={...row,memberships:['LB','SS'] as ('LB'|'SS')[]};const removed={...row,memberships:[]};expect(reconcileRoomMessages([{...original,memberships:['LB']}],[dual])).toEqual([dual]);expect(reconcileRoomMessages([dual],[removed])).toEqual([removed]);});
 it('retains pending sends but replaces acknowledged copies exactly once',()=>{const pending={...row,id:'pending',pending:true};expect(reconcileRoomMessages([row,pending],[{...row}])[1]).toBe(pending);const acknowledged={...pending,pending:false};expect(reconcileRoomMessages([pending],[acknowledged])).toEqual([acknowledged]);});
 it('does not hide permissions, author, attachment order, status or newly supplied fields',()=>{for(const patch of [{member_id:'other'},{author_label:'Renamed'},{attachment_ids:['b','a']},{buddy_status:'failed' as const},{edited_at:'now'},{pending:true},{reply_to_id:'parent'}])expect(sameChatMessage(row,{...row,...patch})).toBe(false);});
});
