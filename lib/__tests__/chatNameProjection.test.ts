import {expect,it,vi} from 'vitest';
import {withMessageMemberships} from '../chatMembershipProjection';
import {withCurrentChatNames,withSearchChatNames} from '../chatNameProjection';
const member='00000000-0000-4000-8000-000000000001',message='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003';
it('enriches only identities in authorized rows, with one bounded lookup and unchanged bodies',async()=>{
 const lookup=vi.fn(async()=>({data:[{id:member,display_name:'New name'},{id:foreign,display_name:'Do not expose'}]}));const db={from:vi.fn(()=>({select:()=>({in:lookup})}))};
 const rows=[{id:message,member_id:member,author_label:'Old name',body:'@Old name text'},{id:'guest',author_label:'Guest'},{id:'bot',bot_slug:'buddy',member_id:member,author_label:'@Buddy'}];
 const result=await withCurrentChatNames(db as never,rows);expect(lookup).toHaveBeenCalledOnce();expect(lookup).toHaveBeenCalledWith('id',[member]);expect(result).toEqual([{...rows[0],author_label:'New name'},rows[1],rows[2]]);
});
it('keeps stored labels on failure and never derives identity from display text',async()=>{const row={author_label:'Alice',body:'unchanged'};const db={from:vi.fn()};expect(await withCurrentChatNames(db as never,[row])).toEqual([row]);expect(db.from).not.toHaveBeenCalled();const unavailable={from:()=>{throw Error('offline');}};expect(await withCurrentChatNames(unavailable as never,[{...row,member_id:member}])).toEqual([{...row,member_id:member}]);});
it('resolves legacy search names only through the authorized message IDs',async()=>{
 const queries:unknown[]=[];const db={from:(table:string)=>({select:()=>({in:async(column:string,ids:string[])=>{queries.push([table,column,ids]);return {data:table==='longboard_chat_messages'?[{id:message,member_id:member,bot_slug:null}]:[{id:member,display_name:'New name'}]};}})})};
 const result=await withSearchChatNames(db as never,[{id:message,author_label:'Historical',body:'text'}]);expect(queries).toEqual([['longboard_chat_messages','id',[message]],['longboard_chat_members','id',[member]]]);expect(result[0]).toMatchObject({id:message,member_id:member,author_label:'New name',body:'text'});
});

it('current display labels remain available when optional badge sources fail',async()=>{const db={rpc:async()=>({error:{message:'badge source unavailable'}}),from:()=>({select:()=>({in:async()=>({data:[{id:member,display_name:'New name'}]})})})};expect(await withMessageMemberships(db as never,[{member_id:member,author_label:'Old',body:'same'}])).toEqual([{member_id:member,author_label:'New name',body:'same',memberships:[]}]);});
